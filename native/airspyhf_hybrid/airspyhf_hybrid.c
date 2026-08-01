/*
 * Continuous Airspy HF+ capture for FM-DX Windows Portable.
 * stdout: WBFM stereo, PCM s16le 48 kHz.
 * fd 3:   complex float32 I/Q at 744187.5 samples/s for libnrsc5.
 * fd 4:   demodulated FM multiplex, mono PCM s16le 192 kHz for RDS.
 * stdin:  live commands: F<frequency_hz>, B<bandwidth_khz>, or Q to stop.
 */
#include <airspyhf.h>
#include <fcntl.h>
#include <io.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <windows.h>

#define INPUT_RATE 768000u
#define AUDIO_RATE 48000u
#define MPX_RATE 192000u
#define PCM_FRAMES 4096u
#define MPX_FRAMES 4096u
#define IQ_FRAMES 8192u
#define ANALOG_DEFAULT_BANDWIDTH_KHZ 190
#define CHANNEL_FILTER_STAGES 6
#define NRSC5_NUMERATOR 3969u
#define NRSC5_DENOMINATOR 4096u

typedef struct {
    airspyhf_device_t *device;
    volatile LONG stop;
    volatile LONG requested_frequency;
    volatile LONG analog_bandwidth_khz;
    volatile LONG reset_requested;
    volatile LONG filter_reset_requested;
    uint32_t frequency;
    double prev_i, prev_q;
    double filter_i[CHANNEL_FILTER_STAGES], filter_i2[CHANNEL_FILTER_STAGES];
    double filter_q[CHANNEL_FILTER_STAGES], filter_q2[CHANNEL_FILTER_STAGES];
    int have_prev;
    uint32_t mpx_phase, audio_phase;
    uint32_t nrsc5_phase;
    double discriminator_sum;
    unsigned int discriminator_count;
    double dc_state, previous_demod;
    double mono_filter[4], diff_filter[4];
    double left_deemphasis, right_deemphasis;
    double pilot_phase, pilot_i, pilot_q, stereo_blend;
    double pilot_energy, composite_energy;
    uint32_t pilot_samples;
    int stereo_detected, mpx_enabled;
    double metric_signal, metric_noise;
    double snr_db;
    uint64_t metric_samples;
    int16_t pcm[PCM_FRAMES * 2u];
    size_t pcm_frames;
    int16_t mpx[MPX_FRAMES];
    size_t mpx_frames;
    airspyhf_complex_float_t iq[IQ_FRAMES];
    size_t iq_frames;
} capture_state_t;

static capture_state_t state;

static int write_all(int fd, const void *buffer, size_t length)
{
    const uint8_t *data = (const uint8_t *)buffer;
    while (length > 0) {
        int amount = (int)(length > 1048576u ? 1048576u : length);
        int written = write(fd, data, amount);
        if (written <= 0) return -1;
        data += written;
        length -= (size_t)written;
    }
    return 0;
}

static int flush_iq(capture_state_t *s)
{
    if (!s->iq_frames) return 0;
    if (write_all(3, s->iq, s->iq_frames * sizeof(s->iq[0])) != 0) return -1;
    s->iq_frames = 0;
    return 0;
}

static int flush_pcm(capture_state_t *s)
{
    if (!s->pcm_frames) return 0;
    if (write_all(1, s->pcm, s->pcm_frames * 2u * sizeof(int16_t)) != 0) return -1;
    s->pcm_frames = 0;
    return 0;
}


static void flush_mpx(capture_state_t *s)
{
    if (!s->mpx_frames || !s->mpx_enabled) return;
    if (write_all(4, s->mpx, s->mpx_frames * sizeof(s->mpx[0])) != 0)
        s->mpx_enabled = 0;
    s->mpx_frames = 0;
}
static void reset_channel_filter(capture_state_t *s)
{
    s->prev_i = s->prev_q = 0.0;
    memset(s->filter_i, 0, sizeof(s->filter_i));
    memset(s->filter_i2, 0, sizeof(s->filter_i2));
    memset(s->filter_q, 0, sizeof(s->filter_q));
    memset(s->filter_q2, 0, sizeof(s->filter_q2));
    s->have_prev = 0;
    s->metric_signal = s->metric_noise = 0.0;
    s->metric_samples = 0;
}

static void reset_dsp(capture_state_t *s)
{
    reset_channel_filter(s);
    s->mpx_phase = s->audio_phase = s->nrsc5_phase = 0;
    s->discriminator_sum = s->dc_state = s->previous_demod = 0.0;
    memset(s->mono_filter, 0, sizeof(s->mono_filter));
    memset(s->diff_filter, 0, sizeof(s->diff_filter));
    s->left_deemphasis = s->right_deemphasis = 0.0;
    s->pilot_phase = s->pilot_i = s->pilot_q = s->stereo_blend = 0.0;
    s->pilot_energy = s->composite_energy = 0.0;
    s->pilot_samples = 0;
    s->stereo_detected = 0;
    s->discriminator_count = 0;
    s->metric_signal = s->metric_noise = 0.0;
    s->snr_db = 0.0;
    s->metric_samples = 0;
    s->pcm_frames = s->mpx_frames = s->iq_frames = 0;
}

static int sample_callback(airspyhf_transfer_t *transfer)
{
    capture_state_t *s = (capture_state_t *)transfer->ctx;
    const double max_phase = 2.0 * M_PI * 75000.0 / (double)INPUT_RATE;
    const double deemphasis_alpha = exp(-1.0 / ((double)AUDIO_RATE * 75e-6));
    const double audio_alpha = 1.0 - exp(-2.0 * M_PI * 15000.0 / (double)MPX_RATE);
    const double pilot_alpha = 1.0 - exp(-2.0 * M_PI * 180.0 / (double)MPX_RATE);
    const double pilot_step = 2.0 * M_PI * 19000.0 / (double)MPX_RATE;
    /* 12th-order Butterworth: steep adjacent-channel rejection without ripple. */
    const double channel_q[CHANNEL_FILTER_STAGES] = {
        0.504314480, 0.541196100, 0.630236207,
        0.821339815, 1.306562965, 3.830648788
    };
    double channel_b0[CHANNEL_FILTER_STAGES], channel_b1[CHANNEL_FILTER_STAGES];
    double channel_b2[CHANNEL_FILTER_STAGES], channel_a1[CHANNEL_FILTER_STAGES];
    double channel_a2[CHANNEL_FILTER_STAGES];
    const LONG analog_bandwidth_khz = InterlockedCompareExchange(&s->analog_bandwidth_khz, 0, 0);
    const double analog_half_bandwidth_hz = (double)analog_bandwidth_khz * 500.0;
    const double channel_w = 2.0 * M_PI * analog_half_bandwidth_hz / (double)INPUT_RATE;
    const double channel_c = cos(channel_w), channel_s = sin(channel_w);
    for (int stage = 0; stage < CHANNEL_FILTER_STAGES; stage++) {
        const double alpha = channel_s / (2.0 * channel_q[stage]);
        const double norm = 1.0 / (1.0 + alpha);
        channel_b0[stage] = 0.5 * (1.0 - channel_c) * norm;
        channel_b1[stage] = (1.0 - channel_c) * norm;
        channel_b2[stage] = channel_b0[stage];
        channel_a1[stage] = -2.0 * channel_c * norm;
        channel_a2[stage] = (1.0 - alpha) * norm;
    }

    if (InterlockedCompareExchange(&s->stop, 0, 0)) return -1;
    if (InterlockedExchange(&s->reset_requested, 0)) reset_dsp(s);
    else if (InterlockedExchange(&s->filter_reset_requested, 0)) reset_channel_filter(s);
    if (transfer->dropped_samples)
        fprintf(stderr, "AIRSPY_DROPPED samples=%llu\n", (unsigned long long)transfer->dropped_samples);

    for (int n = 0; n < transfer->sample_count; n++) {
        const double raw_i = transfer->samples[n].re;
        const double raw_q = transfer->samples[n].im;

        /* Exact 768000 -> 744187.5 conversion: 3969/4096. */
        s->nrsc5_phase += NRSC5_NUMERATOR;
        if (s->nrsc5_phase >= NRSC5_DENOMINATOR) {
            s->nrsc5_phase -= NRSC5_DENOMINATOR;
            s->iq[s->iq_frames++] = transfer->samples[n];
            if (s->iq_frames == IQ_FRAMES && flush_iq(s) != 0) {
                InterlockedExchange(&s->stop, 1);
                return -1;
            }
        }

        double i = raw_i, q = raw_q;
        for (int stage = 0; stage < CHANNEL_FILTER_STAGES; stage++) {
            const double next_i = channel_b0[stage] * i + s->filter_i[stage];
            s->filter_i[stage] = channel_b1[stage] * i - channel_a1[stage] * next_i + s->filter_i2[stage];
            s->filter_i2[stage] = channel_b2[stage] * i - channel_a2[stage] * next_i;
            i = next_i;
            const double next_q = channel_b0[stage] * q + s->filter_q[stage];
            s->filter_q[stage] = channel_b1[stage] * q - channel_a1[stage] * next_q + s->filter_q2[stage];
            s->filter_q2[stage] = channel_b2[stage] * q - channel_a2[stage] * next_q;
            q = next_q;
        }
        const double noise_i = raw_i - i, noise_q = raw_q - q;
        s->metric_signal += i * i + q * q;
        s->metric_noise += noise_i * noise_i + noise_q * noise_q;
        s->metric_samples++;

        if (s->have_prev) {
            s->discriminator_sum += atan2(q * s->prev_i - i * s->prev_q,
                                          i * s->prev_i + q * s->prev_q);
            s->discriminator_count++;
            s->mpx_phase += MPX_RATE;
            if (s->mpx_phase >= INPUT_RATE) {
                s->mpx_phase -= INPUT_RATE;
                double demod = s->discriminator_count ?
                    s->discriminator_sum / s->discriminator_count : 0.0;
                s->discriminator_sum = 0.0;
                s->discriminator_count = 0;
                demod /= max_phase;
                s->dc_state = demod - s->previous_demod + 0.9995 * s->dc_state;
                s->previous_demod = demod;
                double mpx = s->dc_state;
                if (s->mpx_enabled) {
                    double clipped = fmax(-1.0, fmin(1.0, mpx));
                    s->mpx[s->mpx_frames++] = (int16_t)lrint(clipped * 28000.0);
                    if (s->mpx_frames == MPX_FRAMES) flush_mpx(s);
                }
                s->pilot_phase += pilot_step;
                if (s->pilot_phase > M_PI) s->pilot_phase -= 2.0 * M_PI;
                const double pc = cos(s->pilot_phase), ps = sin(s->pilot_phase);
                s->pilot_i += pilot_alpha * (mpx * pc - s->pilot_i);
                s->pilot_q += pilot_alpha * (mpx * ps - s->pilot_q);
                s->pilot_phase += 0.012 * atan2(s->pilot_q, s->pilot_i);
                s->mono_filter[0] += audio_alpha * (mpx - s->mono_filter[0]);
                const double mixed_diff = 2.0 * mpx * cos(2.0 * s->pilot_phase);
                s->diff_filter[0] += audio_alpha * (mixed_diff - s->diff_filter[0]);
                for (int stage = 1; stage < 4; stage++) {
                    s->mono_filter[stage] += audio_alpha * (s->mono_filter[stage - 1] - s->mono_filter[stage]);
                    s->diff_filter[stage] += audio_alpha * (s->diff_filter[stage - 1] - s->diff_filter[stage]);
                }
                const double pilot_level = hypot(s->pilot_i, s->pilot_q) * 2.0;
                /* Weak or multipath FM makes an unlocked L-R channel sound metallic.
                   Blend stereo progressively instead of opening it from pilot level alone. */
                const double pilot_blend = fmax(0.0, fmin(1.0,
                    (pilot_level - 0.012) / 0.014));
                const double snr_blend = fmax(0.0, fmin(1.0,
                    (s->snr_db - 3.0) / 12.0));
                /* A locked pilot always keeps useful stereo separation (30%).
                   Better SNR expands it smoothly to 100%; a lost pilot remains mono. */
                const double target_blend = pilot_blend * (0.30 + 0.70 * snr_blend);
                s->stereo_blend += 0.000035 * (target_blend - s->stereo_blend);
                s->pilot_energy += pilot_level * pilot_level;
                s->composite_energy += mpx * mpx;
                s->pilot_samples++;
                s->audio_phase += AUDIO_RATE;
                if (s->audio_phase >= MPX_RATE) {
                    s->audio_phase -= MPX_RATE;
                    double left = s->mono_filter[3] + s->stereo_blend * s->diff_filter[3];
                    double right = s->mono_filter[3] - s->stereo_blend * s->diff_filter[3];
                    s->left_deemphasis = deemphasis_alpha * s->left_deemphasis + (1.0 - deemphasis_alpha) * left;
                    s->right_deemphasis = deemphasis_alpha * s->right_deemphasis + (1.0 - deemphasis_alpha) * right;
                    left = fmax(-1.0, fmin(1.0, s->left_deemphasis));
                    right = fmax(-1.0, fmin(1.0, s->right_deemphasis));
                    s->pcm[s->pcm_frames * 2] = (int16_t)lrint(left * 24000.0);
                    s->pcm[s->pcm_frames * 2 + 1] = (int16_t)lrint(right * 24000.0);
                    s->pcm_frames++;
                    if (s->pcm_frames == PCM_FRAMES && flush_pcm(s) != 0) {
                        InterlockedExchange(&s->stop, 1);
                        return -1;
                    }
                }
            }
        }
        s->prev_i = i; s->prev_q = q; s->have_prev = 1;

        if (s->metric_samples >= INPUT_RATE) {
            double level = 10.0 * log10(s->metric_signal / (s->metric_samples * 2.0) + 1e-15);
            double in_band = (2.0 * analog_half_bandwidth_hz) /
                             ((double)INPUT_RATE - 2.0 * analog_half_bandwidth_hz);
            double noise = s->metric_noise * in_band;
            double carrier = fmax(s->metric_signal - noise, 1e-15);
            double snr = 10.0 * log10(carrier / (noise + 1e-15));
            if (snr < 0.0) snr = 0.0;
            if (snr > 80.0) snr = 80.0;
            s->snr_db = snr;
            fprintf(stderr, "METRIC level_dbfs=%.1f snr_db=%.1f bandwidth_khz=%ld backend=airspyhf\n", level, snr, analog_bandwidth_khz);
            if (s->pilot_samples) {
                double ratio = 10.0 * log10(s->pilot_energy / (s->composite_energy + 1e-15) + 1e-15);
                int detected = s->stereo_blend > 0.24;
                s->stereo_detected = detected;
                fprintf(stderr, "STEREO detected=%d pilot_db=%.1f backend=airspyhf\n", detected, ratio);
                s->pilot_energy = s->composite_energy = 0.0;
                s->pilot_samples = 0;
            }
            s->metric_signal = s->metric_noise = 0.0;
            s->metric_samples = 0;
        }
    }
    flush_mpx(s);
    if (flush_iq(s) != 0 || flush_pcm(s) != 0) {
        InterlockedExchange(&s->stop, 1);
        return -1;
    }
    return 0;
}

static DWORD WINAPI control_thread(LPVOID unused)
{
    char line[128];
    (void)unused;
    while (fgets(line, sizeof(line), stdin)) {
        if (line[0] == 'F' || line[0] == 'f') {
            unsigned long value = strtoul(line + 1, NULL, 10);
            if (value >= 87500000ul && value <= 108000000ul)
                InterlockedExchange(&state.requested_frequency, (LONG)value);
        } else if (line[0] == 'B' || line[0] == 'b') {
            LONG value = (LONG)strtol(line + 1, NULL, 10);
            if (value == 120 || value == 140 || value == 160 || value == 190) {
                if (InterlockedExchange(&state.analog_bandwidth_khz, value) != value)
                    InterlockedExchange(&state.filter_reset_requested, 1);
                fprintf(stderr, "BANDWIDTH %ld kHz backend=airspyhf\n", value);
            }
        } else if (line[0] == 'Q' || line[0] == 'q') {
            InterlockedExchange(&state.stop, 1);
            break;
        }
    }
    return 0;
}

static int supports_rate(airspyhf_device_t *device, uint32_t wanted)
{
    uint32_t count = 0;
    if (airspyhf_get_samplerates(device, &count, 0) != AIRSPYHF_SUCCESS || !count) return 0;
    uint32_t *rates = (uint32_t *)malloc(count * sizeof(uint32_t));
    if (!rates) return 0;
    int found = 0;
    if (airspyhf_get_samplerates(device, rates, count) == AIRSPYHF_SUCCESS)
        for (uint32_t i = 0; i < count; i++) if (rates[i] == wanted) found = 1;
    free(rates);
    return found;
}

int main(int argc, char **argv)
{
    if (argc < 4) {
        fprintf(stderr, "Usage: airspyhf_hybrid frequency_hz serial|auto attenuation_db [bandwidth_khz]\n");
        return 2;
    }
    memset(&state, 0, sizeof(state));
    state.mpx_enabled = 1;
    state.analog_bandwidth_khz = ANALOG_DEFAULT_BANDWIDTH_KHZ;
    if (argc >= 5) {
        LONG requested_bandwidth = (LONG)strtol(argv[4], NULL, 10);
        if (requested_bandwidth == 120 || requested_bandwidth == 140 || requested_bandwidth == 160 || requested_bandwidth == 190)
            state.analog_bandwidth_khz = requested_bandwidth;
    }
    state.frequency = (uint32_t)strtoul(argv[1], NULL, 10);
    if (state.frequency < 87500000u || state.frequency > 108000000u) return 2;
    const float attenuation = (float)strtod(argv[3], NULL);

    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(3, _O_BINARY);
    _setmode(4, _O_BINARY);

    int result;
    uint64_t serial = 0;
    if (_stricmp(argv[2], "auto") == 0 || strcmp(argv[2], "0") == 0) {
        result = airspyhf_open(&state.device);
    } else {
        serial = _strtoui64(argv[2], NULL, 0);
        result = airspyhf_open_sn(&state.device, serial);
    }
    if (result != AIRSPYHF_SUCCESS) {
        fprintf(stderr, "Failed to open Airspy HF+ (serial=%s, error=%d)\n", argv[2], result);
        return 3;
    }
    if (!supports_rate(state.device, INPUT_RATE)) {
        fprintf(stderr, "Airspy HF+ does not provide the required 768 kS/s rate\n");
        airspyhf_close(state.device);
        return 4;
    }
    if (airspyhf_set_samplerate(state.device, INPUT_RATE) != AIRSPYHF_SUCCESS ||
        airspyhf_set_lib_dsp(state.device, 1) != AIRSPYHF_SUCCESS ||
        airspyhf_set_att(state.device, attenuation) != AIRSPYHF_SUCCESS ||
        airspyhf_set_freq(state.device, state.frequency) != AIRSPYHF_SUCCESS) {
        fprintf(stderr, "Airspy HF+ setup failed\n");
        airspyhf_close(state.device);
        return 5;
    }

    reset_dsp(&state);
    HANDLE controller = CreateThread(NULL, 0, control_thread, NULL, 0, NULL);
    if (controller) CloseHandle(controller);
    if (airspyhf_start(state.device, sample_callback, &state) != AIRSPYHF_SUCCESS) {
        fprintf(stderr, "Airspy HF+ stream failed to start\n");
        airspyhf_close(state.device);
        return 6;
    }
    fprintf(stderr, "AIRSPYHF_READY serial=%s rate=%u attenuation_db=%.1f bandwidth_khz=%ld freq=%.3f\n",
            serial ? argv[2] : "auto", INPUT_RATE, attenuation, state.analog_bandwidth_khz, state.frequency / 1000000.0);

    while (!InterlockedCompareExchange(&state.stop, 0, 0) && airspyhf_is_streaming(state.device)) {
        LONG pending = InterlockedExchange(&state.requested_frequency, 0);
        if (pending && (uint32_t)pending != state.frequency) {
            if (airspyhf_set_freq(state.device, (uint32_t)pending) == AIRSPYHF_SUCCESS) {
                state.frequency = (uint32_t)pending;
                InterlockedExchange(&state.reset_requested, 1);
                fprintf(stderr, "TUNED %.3f MHz backend=airspyhf\n", state.frequency / 1000000.0);
            } else {
                fprintf(stderr, "TUNE_ERROR %.3f MHz backend=airspyhf\n", pending / 1000000.0);
            }
        }
        Sleep(10);
    }
    InterlockedExchange(&state.stop, 1);
    airspyhf_stop(state.device);
    airspyhf_close(state.device);
    return 0;
}
