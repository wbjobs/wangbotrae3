#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <vector>
#include <algorithm>

extern "C" {

struct alignas(16) ImageBuffer {
    uint8_t* data;
    int32_t width;
    int32_t height;
    int32_t channels;
};

struct Kernel {
    float* weights;
    int32_t in_channels;
    int32_t out_channels;
    int32_t kernel_size;
};

static std::vector<float> g_style_gram;
static bool g_style_initialized = false;

static void relu(float* data, int32_t size) {
    for (int32_t i = 0; i < size; ++i) {
        data[i] = std::max(0.0f, data[i]);
    }
}

static void conv2d(const float* input, const Kernel* kernel, float* output,
                   int32_t in_h, int32_t in_w, int32_t out_h, int32_t out_w) {
    int32_t pad = kernel->kernel_size / 2;
    int32_t stride = 1;

    for (int32_t oc = 0; oc < kernel->out_channels; ++oc) {
        for (int32_t oh = 0; oh < out_h; ++oh) {
            for (int32_t ow = 0; ow < out_w; ++ow) {
                float sum = 0.0f;
                for (int32_t ic = 0; ic < kernel->in_channels; ++ic) {
                    for (int32_t kh = 0; kh < kernel->kernel_size; ++kh) {
                        int32_t ih = oh * stride - pad + kh;
                        if (ih < 0 || ih >= in_h) continue;
                        for (int32_t kw = 0; kw < kernel->kernel_size; ++kw) {
                            int32_t iw = ow * stride - pad + kw;
                            if (iw < 0 || iw >= in_w) continue;
                            
                            int32_t in_idx = ic * in_h * in_w + ih * in_w + iw;
                            int32_t w_idx = oc * kernel->in_channels * kernel->kernel_size * kernel->kernel_size +
                                          ic * kernel->kernel_size * kernel->kernel_size +
                                          kh * kernel->kernel_size + kw;
                            sum += input[in_idx] * kernel->weights[w_idx];
                        }
                    }
                }
                output[oc * out_h * out_w + oh * out_w + ow] = sum;
            }
        }
    }
}

static void upsample_bilinear(const float* input, float* output,
                              int32_t in_h, int32_t in_w, int32_t in_c,
                              int32_t out_h, int32_t out_w) {
    float scale_h = static_cast<float>(in_h) / out_h;
    float scale_w = static_cast<float>(in_w) / out_w;

    for (int32_t c = 0; c < in_c; ++c) {
        for (int32_t oh = 0; oh < out_h; ++oh) {
            for (int32_t ow = 0; ow < out_w; ++ow) {
                float ih_f = (oh + 0.5f) * scale_h - 0.5f;
                float iw_f = (ow + 0.5f) * scale_w - 0.5f;
                
                ih_f = std::max(0.0f, std::max(0.0f, ih_f));
                iw_f = std::max(0.0f, std::max(0.0f, iw_f));
                
                int32_t ih0 = static_cast<int32_t>(std::floor(ih_f));
                int32_t iw0 = static_cast<int32_t>(std::floor(iw_f));
                int32_t ih1 = std::min(ih0 + 1, in_h - 1);
                int32_t iw1 = std::min(iw0 + 1, in_w - 1);
                
                float h_diff = ih_f - ih0;
                float w_diff = iw_f - iw0;
                
                auto get_val = [&](int32_t y, int32_t x) {
                    return input[c * in_h * in_w + y * in_w + x];
                };
                
                float v00 = get_val(ih0, iw0);
                float v01 = get_val(ih0, iw1);
                float v10 = get_val(ih1, iw0);
                float v11 = get_val(ih1, iw1);
                
                float v0 = v00 * (1 - w_diff) + v01 * w_diff;
                float v1 = v10 * (1 - w_diff) + v11 * w_diff;
                float v = v0 * (1 - h_diff) + v1 * h_diff;
                
                output[c * out_h * out_w + oh * out_w + ow] = v;
            }
        }
    }
}

static void instance_norm(float* data, int32_t channels, int32_t height, int32_t width) {
    const float eps = 1e-5f;
    for (int32_t c = 0; c < channels; ++c) {
        float sum = 0.0f;
        float sum_sq = 0.0f;
        int32_t n = height * width;
        
        for (int32_t i = 0; i < n; ++i) {
            float val = data[c * height * width + i];
            sum += val;
            sum_sq += val * val;
        }
        
        float mean = sum / n;
        float var = (sum_sq / n - mean * mean);
        float inv_std = 1.0f / std::sqrt(var + eps);
        
        for (int32_t i = 0; i < n; ++i) {
            data[c * height * width + i] = (data[c * height * width + i] - mean) * inv_std;
        }
    }
}

static void residual_block(float* data, int32_t channels, int32_t height, int32_t width,
                          const float* conv1_w, const float* conv2_w) {
    std::vector<float> temp(channels * height * width);
    std::vector<float> residual(channels * height * width);
    
    std::memcpy(residual.data(), data, channels * height * width * sizeof(float));
    
    Kernel k1 = {const_cast<float*>(conv1_w), channels, channels, 3};
    conv2d(data, &k1, temp.data(), height, width, height, width);
    instance_norm(temp.data(), channels, height, width);
    relu(temp.data(), channels * height * width);
    
    Kernel k2 = {const_cast<float*>(conv2_w), channels, channels, 3};
    conv2d(temp.data(), &k2, data, height, width, height, width);
    instance_norm(data, channels, height, width);
    
    for (int32_t i = 0; i < channels * height * width; ++i) {
        data[i] += residual[i];
    }
}

static std::vector<float> create_vgg_weights(int32_t layer) {
    std::vector<float> weights;
    if (layer == 0) {
        weights.resize(3 * 3 * 3 * 64, 0.0f);
        for (int32_t i = 0; i < 64; ++i) {
            for (int32_t j = 0; j < 27; ++j) {
                weights[i * 27 + j] = (std::sin(i + j) * 0.1f);
            }
        }
    } else if (layer == 1) {
        weights.resize(64 * 3 * 3 * 128, 0.0f);
        for (int32_t i = 0; i < 128; ++i) {
            for (int32_t j = 0; j < 64 * 9; ++j) {
                weights[i * 64 * 9 + j] = (std::sin(i * 2 + j) * 0.08f);
            }
        }
    } else if (layer == 2) {
        weights.resize(128 * 3 * 3 * 256, 0.0f);
        for (int32_t i = 0; i < 256; ++i) {
            for (int32_t j = 0; j < 128 * 9; ++j) {
                weights[i * 128 * 9 + j] = (std::sin(i * 3 + j) * 0.06f);
            }
        }
    }
    return weights;
}

static void extract_features(const float* input, int32_t height, int32_t width,
                            std::vector<float>& features) {
    static std::vector<float> w1 = create_vgg_weights(0);
    static std::vector<float> w2 = create_vgg_weights(1);
    static std::vector<float> w3 = create_vgg_weights(2);
    
    std::vector<float> conv1(64 * height * width);
    Kernel k1 = {w1.data(), 3, 64, 3};
    conv2d(input, &k1, conv1.data(), height, width, height, width);
    relu(conv1.data(), 64 * height * width);
    
    int32_t h2 = height / 2;
    int32_t w2_dim = width / 2;
    std::vector<float> pool1(64 * h2 * w2_dim);
    for (int32_t c = 0; c < 64; ++c) {
        for (int32_t h = 0; h < h2; ++h) {
            for (int32_t w = 0; w < w2_dim; ++w) {
                float max_val = -1e10f;
                for (int32_t kh = 0; kh < 2; ++kh) {
                    for (int32_t kw = 0; kw < 2; ++kw) {
                        int32_t idx = c * height * width + (h * 2 + kh) * width + (w * 2 + kw);
                        max_val = std::max(max_val, conv1[idx]);
                    }
                }
                pool1[c * h2 * w2_dim + h * w2_dim + w] = max_val;
            }
        }
    }
    
    std::vector<float> conv2(128 * h2 * w2_dim);
    Kernel k2 = {w2.data(), 64, 128, 3};
    conv2d(pool1.data(), &k2, conv2.data(), h2, w2_dim, h2, w2_dim);
    relu(conv2.data(), 128 * h2 * w2_dim);
    
    features = std::move(conv2);
}

static void compute_gram_matrix(const float* features, int32_t channels,
                               int32_t height, int32_t width,
                               std::vector<float>& gram) {
    gram.resize(channels * channels, 0.0f);
    int32_t n = height * width;
    
    for (int32_t i = 0; i < channels; ++i) {
        for (int32_t j = 0; j < channels; ++j) {
            float sum = 0.0f;
            for (int32_t k = 0; k < n; ++k) {
                sum += features[i * n + k] * features[j * n + k];
            }
            gram[i * channels + j] = sum / n;
        }
    }
}

__attribute__((export_name("init_style")))
void init_style(const uint8_t* style_data, int32_t width, int32_t height) {
    std::vector<float> normalized(3 * height * width);
    for (int32_t i = 0; i < 3 * height * width; ++i) {
        normalized[i] = (style_data[i] / 255.0f - 0.5f) * 2.0f;
    }
    
    std::vector<float> features;
    extract_features(normalized.data(), height, width, features);
    compute_gram_matrix(features.data(), 128, height / 2, width / 2, g_style_gram);
    g_style_initialized = true;
}

__attribute__((export_name("transfer_frame")))
void transfer_frame(const uint8_t* input, uint8_t* output,
                    int32_t width, int32_t height, float style_strength) {
    if (!g_style_initialized) return;
    
    std::vector<float> normalized(3 * height * width);
    for (int32_t i = 0; i < 3 * height * width; ++i) {
        normalized[i] = (input[i] / 255.0f - 0.5f) * 2.0f;
    }
    
    std::vector<float> content_features;
    extract_features(normalized.data(), height, width, content_features);
    
    std::vector<float> content_gram;
    compute_gram_matrix(content_features.data(), 128, height / 2, width / 2, content_gram);
    
    for (size_t i = 0; i < content_gram.size(); ++i) {
        content_gram[i] = content_gram[i] * (1 - style_strength) + g_style_gram[i] * style_strength;
    }
    
    std::vector<float> stylized = normalized;
    
    for (int32_t y = 0; y < height; ++y) {
        for (int32_t x = 0; x < width; ++x) {
            float noise_x = std::sin(x * 0.1f + y * 0.05f) * 0.1f * style_strength;
            float noise_y = std::cos(x * 0.05f + y * 0.1f) * 0.1f * style_strength;
            
            for (int32_t c = 0; c < 3; ++c) {
                int32_t idx = c * height * width + y * width + x;
                float style_mix = 0.0f;
                for (int32_t gc = 0; gc < 8; ++gc) {
                    int32_t gram_idx = (gc * 16 + (c * 3 + gc % 3)) % (128 * 128);
                    style_mix += g_style_gram[gram_idx] * 0.01f;
                }
                stylized[idx] = stylized[idx] * (1 - style_strength * 0.3f) + 
                               style_mix * style_strength +
                               noise_x * 0.5f + noise_y * 0.5f;
            }
        }
    }
    
    for (int32_t i = 0; i < 3 * height * width; ++i) {
        float val = (stylized[i] / 2.0f + 0.5f) * 255.0f;
        output[i] = static_cast<uint8_t>(std::max(0, std::min(255, static_cast<int32_t>(val))));
    }
}

__attribute__((export_name("process_frame_fast")))
void process_frame_fast(const uint8_t* input, uint8_t* output,
                       int32_t width, int32_t height, float style_strength) {
    if (!g_style_initialized) {
        std::memcpy(output, input, width * height * 3);
        return;
    }
    
    const int block_size = 8;
    
    for (int32_t by = 0; by < height; by += block_size) {
        for (int32_t bx = 0; bx < width; bx += block_size) {
            float block_sum[3] = {0, 0, 0};
            int count = 0;
            
            for (int32_t y = by; y < std::min(by + block_size, height); ++y) {
                for (int32_t x = bx; x < std::min(bx + block_size, width); ++x) {
                    for (int32_t c = 0; c < 3; ++c) {
                        block_sum[c] += input[c * height * width + y * width + x];
                    }
                    count++;
                }
            }
            
            float style_mix = 0.0f;
            int gram_idx = ((by / block_size) * 17 + (bx / block_size) * 13) % (128 * 128);
            style_mix = g_style_gram[gram_idx] * 50.0f;
            
            for (int32_t y = by; y < std::min(by + block_size, height); ++y) {
                for (int32_t x = bx; x < std::min(bx + block_size, width); ++x) {
                    float noise = std::sin(x * 0.02f + y * 0.03f) * 20.0f * style_strength;
                    for (int32_t c = 0; c < 3; ++c) {
                        int32_t idx = c * height * width + y * width + x;
                        float val = input[idx];
                        val = val * (1 - style_strength * 0.5f) + 
                              (style_mix + block_sum[c] / count * 0.5f) * style_strength * 0.5f +
                              noise;
                        output[idx] = static_cast<uint8_t>(std::max(0, std::min(255, static_cast<int32_t>(val))));
                    }
                }
            }
        }
    }
}

}
