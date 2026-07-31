/*
 * Single-device RTL-SDR capture for FM-DX Windows Portable.
 * stdout: analog WBFM mono duplicated to stereo, PCM s16le 48 kHz.
 * fd 3:   original CU8 I/Q at 1,488,375 samples/s for libnrsc5.
 * stdin:  live tune commands: F<frequency_hz>.
 */
#include <rtl-sdr.h>
#include <errno.h>
#include <fcntl.h>
#include <io.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <windows.h>

#define IQ_RATE 1488375u
#define AUDIO_RATE 48000u
#define READ_SIZE 262144u
#define PCM_FRAMES 8192u
#define FM_HALF_BANDWIDTH_HZ 200000.0

static volatile LONG requested_frequency = 0;
static volatile LONG control_closed = 0;

static DWORD WINAPI control_thread(LPVOID unused)
{
    char line[128];
    (void)unused;
    while (fgets(line, sizeof(line), stdin)) {
        if (line[0] == 'F' || line[0] == 'f') {
            unsigned long value = strtoul(line + 1, NULL, 10);
            if (value >= 87500000ul && value <= 108000000ul)
                InterlockedExchange(&requested_frequency, (LONG)value);
        } else if (line[0] == 'Q' || line[0] == 'q') {
            InterlockedExchange(&control_closed, 1);
            return 0;
        }
    }
    return 0;
}

static int write_all(int fd, const uint8_t *data, size_t length)
{
    while (length > 0) {
        int written = write(fd, data, (unsigned int)(length > 1048576 ? 1048576 : length));
        if (written <= 0) return -1;
        data += written;
        length -= (size_t)written;
    }
    return 0;
}

static int nearest_gain(rtlsdr_dev_t *dev, double requested_db)
{
    int count = rtlsdr_get_tuner_gains(dev, NULL);
    if (count <= 0) return (int)lrint(requested_db * 10.0);
    int *gains = (int *)malloc((size_t)count * sizeof(int));
    if (!gains || rtlsdr_get_tuner_gains(dev, gains) != count) {
        free(gains);
        return (int)lrint(requested_db * 10.0);
    }
    int wanted = (int)lrint(requested_db * 10.0);
    int best = gains[0];
    for (int i = 1; i < count; i++)
        if (abs(gains[i] - wanted) < abs(best - wanted)) best = gains[i];
    free(gains);
    return best;
}

int main(int argc, char **argv)
{
    if (argc < 5) {
        fprintf(stderr, "Usage: rtl_hybrid frequency_hz device gain_db|auto ppm\n");
        return 2;
    }

    uint32_t frequency = (uint32_t)strtoul(argv[1], NULL, 10);
    const uint32_t device_index = (uint32_t)strtoul(argv[2], NULL, 10);
    const int automatic_gain = strcmp(argv[3], "auto") == 0;
    const double requested_gain = automatic_gain ? 0.0 : strtod(argv[3], NULL);
    const int ppm = atoi(argv[4]);
    if (frequency < 87500000u || frequency > 108000000u) {
        fprintf(stderr, "Frequency outside 87.5-108.0 MHz\n");
        return 2;
    }

    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(3, _O_BINARY);

    rtlsdr_dev_t *dev = NULL;
    if (rtlsdr_open(&dev, device_index) != 0) {
        fprintf(stderr, "Failed to open RTL-SDR device %u\n", device_index);
        return 3;
    }

    int rc = 0;
    if (rtlsdr_set_sample_rate(dev, IQ_RATE) != 0) rc = 4;
    if (!rc && rtlsdr_set_tuner_gain_mode(dev, automatic_gain ? 0 : 1) != 0) rc = 6;
    if (!rc && !automatic_gain) {
        int gain = nearest_gain(dev, requested_gain);
        if (rtlsdr_set_tuner_gain(dev, gain) != 0) rc = 7;
        else fprintf(stderr, "RTL gain %.1f dB\n", gain / 10.0);
    }
    if (!rc && rtlsdr_set_center_freq(dev, frequency) != 0) rc = 8;
    if (!rc) (void)rtlsdr_set_offset_tuning(dev, 1);
    if (!rc && ppm != 0 && rtlsdr_set_freq_correction(dev, ppm) != 0)
        fprintf(stderr, "Warning: PPM correction %d was not accepted; continuing\n", ppm);
    if (!rc && rtlsdr_reset_buffer(dev) != 0) rc = 9;
    if (rc) {
        fprintf(stderr, "RTL-SDR setup failed (%d)\n", rc);
        rtlsdr_close(dev);
        return rc;
    }

    HANDLE controller = CreateThread(NULL, 0, control_thread, NULL, 0, NULL);
    if (controller) CloseHandle(controller);
    fprintf(stderr, "Hybrid capture %.3f MHz: continuous analog 400 kHz + NRSC-5 IQ\n",
            frequency / 1000000.0);

    uint8_t *iq = (uint8_t *)malloc(READ_SIZE);
    int16_t *pcm = (int16_t *)malloc(PCM_FRAMES * 2u * sizeof(int16_t));
    if (!iq || !pcm) {
        fprintf(stderr, "Out of memory\n");
        free(iq); free(pcm); rtlsdr_close(dev);
        return 10;
    }

    double prev_i = 0.0, prev_q = 0.0;
    double filter_i[4] = {0}, filter_q[4] = {0};
    int have_prev = 0;
    uint64_t resample_phase = 0;
    double discriminator_sum = 0.0;
    unsigned int discriminator_count = 0;
    double dc_state = 0.0, previous_demod = 0.0, deemphasis = 0.0;
    const double max_phase = 2.0 * M_PI * 75000.0 / (double)IQ_RATE;
    const double deemphasis_alpha = exp(-1.0 / ((double)AUDIO_RATE * 75e-6));
    /* Four cascaded poles: place the combined -3 dB point at 200 kHz. */
    const double pole_cutoff = FM_HALF_BANDWIDTH_HZ / sqrt(pow(2.0, 0.25) - 1.0);
    const double channel_alpha = 1.0 - exp(-2.0 * M_PI * pole_cutoff / (double)IQ_RATE);
    size_t pcm_frames = 0;
    double metric_signal = 0.0, metric_noise = 0.0;
    uint64_t metric_samples = 0;

    for (;;) {
        LONG pending = InterlockedExchange(&requested_frequency, 0);
        if (pending) {
            uint32_t next = (uint32_t)pending;
            if (next != frequency) {
                if (rtlsdr_set_center_freq(dev, next) == 0) {
                    frequency = next;
                    (void)rtlsdr_reset_buffer(dev);
                    prev_i = prev_q = 0.0;
                    memset(filter_i, 0, sizeof(filter_i));
                    memset(filter_q, 0, sizeof(filter_q));
                    have_prev = 0;
                    resample_phase = 0;
                    discriminator_sum = dc_state = previous_demod = deemphasis = 0.0;
                    discriminator_count = 0;
                    metric_signal = metric_noise = 0.0;
                    metric_samples = 0;
                    fprintf(stderr, "TUNED %.3f MHz\n", frequency / 1000000.0);
                } else {
                    fprintf(stderr, "TUNE_ERROR %.3f MHz\n", next / 1000000.0);
                }
            }
        }
        if (InterlockedCompareExchange(&control_closed, 0, 0)) break;

        int received = 0;
        if (rtlsdr_read_sync(dev, iq, READ_SIZE, &received) != 0 || received <= 0) break;
        received &= ~3;
        if (write_all(3, iq, (size_t)received) != 0) {
            fprintf(stderr, "NRSC-5 IQ pipe closed\n");
            break;
        }

        for (int n = 0; n < received; n += 2) {
            const double raw_i = (double)iq[n] - 127.5;
            const double raw_q = (double)iq[n + 1] - 127.5;
            filter_i[0] += channel_alpha * (raw_i - filter_i[0]);
            filter_q[0] += channel_alpha * (raw_q - filter_q[0]);
            for (int stage = 1; stage < 4; stage++) {
                filter_i[stage] += channel_alpha * (filter_i[stage - 1] - filter_i[stage]);
                filter_q[stage] += channel_alpha * (filter_q[stage - 1] - filter_q[stage]);
            }
            const double i = filter_i[3];
            const double q = filter_q[3];
            const double noise_i = raw_i - i;
            const double noise_q = raw_q - q;
            metric_signal += i * i + q * q;
            metric_noise += noise_i * noise_i + noise_q * noise_q;
            metric_samples++;

            if (have_prev) {
                const double cross = q * prev_i - i * prev_q;
                const double dot = i * prev_i + q * prev_q;
                discriminator_sum += atan2(cross, dot);
                discriminator_count++;
                resample_phase += AUDIO_RATE;
                if (resample_phase >= IQ_RATE) {
                    resample_phase -= IQ_RATE;
                    double demod = discriminator_count ? discriminator_sum / discriminator_count : 0.0;
                    discriminator_sum = 0.0;
                    discriminator_count = 0;
                    demod /= max_phase;
                    dc_state = demod - previous_demod + 0.995 * dc_state;
                    previous_demod = demod;
                    deemphasis = deemphasis_alpha * deemphasis + (1.0 - deemphasis_alpha) * dc_state;
                    if (deemphasis > 1.0) deemphasis = 1.0;
                    if (deemphasis < -1.0) deemphasis = -1.0;
                    int16_t sample = (int16_t)lrint(deemphasis * 28000.0);
                    pcm[pcm_frames * 2] = sample;
                    pcm[pcm_frames * 2 + 1] = sample;
                    pcm_frames++;
                    if (pcm_frames == PCM_FRAMES) {
                        if (write_all(1, (const uint8_t *)pcm, pcm_frames * 4u) != 0) goto done;
                        pcm_frames = 0;
                    }
                }
            }
            prev_i = i; prev_q = q; have_prev = 1;

            if (metric_samples >= IQ_RATE) {
                double level = 10.0 * log10(metric_signal / (metric_samples * 2.0 * 127.5 * 127.5) + 1e-15);
                const double in_band_fraction = (2.0 * FM_HALF_BANDWIDTH_HZ) /
                                                ((double)IQ_RATE - 2.0 * FM_HALF_BANDWIDTH_HZ);
                const double noise_in_band = metric_noise * in_band_fraction;
                const double carrier_power = fmax(metric_signal - noise_in_band, 1e-12);
                double snr = 10.0 * log10(carrier_power / (noise_in_band + 1e-12));
                if (snr < 0.0) snr = 0.0;
                if (snr > 60.0) snr = 60.0;
                fprintf(stderr, "METRIC level_dbfs=%.1f snr_db=%.1f bandwidth_khz=400\n", level, snr);
                metric_signal = metric_noise = 0.0;
                metric_samples = 0;
            }
        }
        if (pcm_frames && write_all(1, (const uint8_t *)pcm, pcm_frames * 4u) != 0) break;
        pcm_frames = 0;
    }

done:
    free(iq);
    free(pcm);
    rtlsdr_close(dev);
    return 0;
}
