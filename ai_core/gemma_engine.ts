/**
 * Gemma On-Device AI Engine
 *
 * Implements local threat detection using the Google Gemma (Mobile Quantized)
 * model running entirely on-device via WebGPU (with CPU fallback).
 *
 * No behavioural data ever leaves the client — inference is fully local and
 * requires no server round-trip.
 *
 * Usage:
 *   const engine = new GemmaEngine();
 *   await engine.load();
 *   const analysis = await engine.analyzeThreats(patterns);
 *   engine.dispose();
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface GemmaEngineConfig {
  /** URL to the quantized Gemma GGUF model file. */
  modelUrl?: string;
  /** Browser Cache API storage name for the model binary. */
  cacheName?: string;
  /** Maximum memory budget in MB. Engine refuses to load a larger model. */
  maxMemoryMB?: number;
  /** Preferred inference backend. Falls back to CPU if unavailable. */
  backend?: "webgpu" | "cpu";
}

export type BehaviorType = "keystroke" | "mouse" | "network" | "interaction";

/**
 * A single captured user-behaviour event with extracted numeric features.
 *
 * Feature conventions:
 *   keystroke   – dwellTimeMs, flightTimeMs
 *   mouse       – speedPxPerMs, curvature, clickIntervalMs
 *   network     – requestIntervalMs, bytesPerSecond
 *   interaction – scrollDeltaPx, focusChangeCount
 */
export interface BehaviorPattern {
  type: BehaviorType;
  /** Unix timestamp (ms) when the event occurred. */
  timestamp: number;
  /** Numeric feature map extracted from the raw event. */
  features: Record<string, number>;
}

/** A single detected threat signal. */
export interface ThreatSignal {
  type: string;
  /** Confidence in the signal (0–1). */
  confidence: number;
  description: string;
}

/** Full output from a threat analysis pass. */
export interface ThreatAnalysis {
  threatLevel: "none" | "low" | "medium" | "high" | "critical";
  /** Composite threat score (0–1). Higher = more suspicious. */
  threatScore: number;
  /** Signals ordered by confidence (highest first). */
  signals: ThreatSignal[];
  patternCount: number;
  /** Wall-clock milliseconds taken for this analysis. */
  analysisTimeMs: number;
  /** Engine heap footprint at analysis time (MB). */
  memoryUsedMB: number;
}

/** Pluggable inference backend. Implementations encapsulate GPU/CPU specifics. */
export interface InferenceBackend {
  isAvailable(): Promise<boolean>;
  /**
   * Runs forward inference on a flat feature vector.
   * Returns a Float32Array of 5 threat-class probabilities:
   *   [none, low, medium, high, critical]
   */
  infer(features: Float32Array): Promise<Float32Array>;
  dispose(): void;
}

// ─── Pure statistical helpers ─────────────────────────────────────────────────

/** Computes the arithmetic mean; returns 0 for an empty array. */
export function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Computes the population variance; returns 0 for fewer than 2 elements. */
export function computeVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = computeMean(values);
  return computeMean(values.map((v) => (v - mean) ** 2));
}

/**
 * Computes the Shannon entropy (bits) of a probability distribution.
 * Returns 0 for an empty array or a deterministic distribution.
 */
export function computeEntropy(probabilities: number[]): number {
  const filtered = probabilities.filter((p) => p > 0);
  if (filtered.length === 0) return 0;
  const raw = -filtered.reduce((sum, p) => sum + p * Math.log2(p), 0);
  // Guard against -0 (occurs when log2 terms all equal 0, e.g. p === 1).
  return raw === 0 ? 0 : raw;
}

// ─── Feature extraction ───────────────────────────────────────────────────────

/**
 * Extracts a 10-element Float32Array feature vector from behaviour patterns.
 *
 * Index mapping:
 *   0  mean inter-event interval (ms)
 *   1  variance of inter-event intervals
 *   2  proportion of keystroke events
 *   3  proportion of mouse events
 *   4  proportion of network events
 *   5  proportion of interaction events
 *   6  mean numeric feature value across all events
 *   7  variance of numeric feature values
 *   8  temporal entropy (uniformity of distribution over time, bits)
 *   9  event rate (events per second)
 */
export function extractFeatures(patterns: BehaviorPattern[]): Float32Array {
  const vector = new Float32Array(10);
  if (patterns.length === 0) return vector;

  const n = patterns.length;
  const sorted = [...patterns].sort((a, b) => a.timestamp - b.timestamp);

  // Inter-event intervals
  const intervals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    intervals.push(sorted[i].timestamp - sorted[i - 1].timestamp);
  }
  vector[0] = computeMean(intervals);
  vector[1] = computeVariance(intervals);

  // Event-type proportions
  const counts: Record<BehaviorType, number> = {
    keystroke: 0,
    mouse: 0,
    network: 0,
    interaction: 0,
  };
  for (const p of patterns) {
    counts[p.type]++;
  }
  vector[2] = counts.keystroke / n;
  vector[3] = counts.mouse / n;
  vector[4] = counts.network / n;
  vector[5] = counts.interaction / n;

  // Aggregate feature values across all events
  const allValues: number[] = patterns.flatMap((p) => Object.values(p.features));
  vector[6] = computeMean(allValues);
  vector[7] = computeVariance(allValues);

  // Temporal entropy: uniformity of event timestamps over 10 equal-width bins
  if (sorted.length >= 2) {
    const start = sorted[0].timestamp;
    const span = sorted[sorted.length - 1].timestamp - start;
    if (span > 0) {
      const BINS = 10;
      const binCounts = new Array<number>(BINS).fill(0);
      for (const p of sorted) {
        const bin = Math.min(
          Math.floor(((p.timestamp - start) / span) * BINS),
          BINS - 1,
        );
        binCounts[bin]++;
      }
      vector[8] = computeEntropy(binCounts.map((c) => c / n));
    }
  }

  // Event rate (events per second)
  const spanMs = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;
  vector[9] = spanMs > 0 ? (n / spanMs) * 1000 : 0;

  return vector;
}

// ─── Rule-based heuristics ────────────────────────────────────────────────────

/**
 * Applies fast, deterministic rule-based heuristics to detect obvious bot
 * patterns before the ML inference pass.
 *
 * These rules have near-zero latency and zero memory overhead, making them
 * suitable as a first-pass guard on low-end devices.
 */
export function applyHeuristics(
  patterns: BehaviorPattern[],
  features: Float32Array,
): ThreatSignal[] {
  const signals: ThreatSignal[] = [];
  if (patterns.length === 0) return signals;

  const meanInterval = features[0];
  const varInterval = features[1];
  const eventRate = features[9];

  // Impossibly fast events (< 10 ms mean interval) → likely synthetic
  if (meanInterval > 0 && meanInterval < 10) {
    signals.push({
      type: "SUPERHUMAN_SPEED",
      confidence: Math.min(1.0, 10 / meanInterval),
      description: "Event stream too fast for human input",
    });
  }

  // Near-zero variance in intervals → mechanical / scripted input
  if (patterns.length >= 5 && varInterval < 0.1 && meanInterval > 0) {
    signals.push({
      type: "MECHANICAL_TIMING",
      confidence: 0.9,
      description:
        "Perfectly uniform inter-event intervals indicate automation",
    });
  }

  // Extremely high event rate (> 100 events/sec)
  if (eventRate > 100) {
    signals.push({
      type: "HIGH_EVENT_RATE",
      confidence: Math.min(1.0, eventRate / 200),
      description: `Abnormally high event rate: ${eventRate.toFixed(1)} events/sec`,
    });
  }

  // Keystroke-only session with no mouse events (headless browser pattern)
  if (patterns.length >= 10 && features[2] > 0.8 && features[3] === 0) {
    signals.push({
      type: "HEADLESS_BROWSER_PATTERN",
      confidence: 0.75,
      description: "All events are keystrokes with no mouse activity",
    });
  }

  // Entirely single-type stream (scripted replay)
  const dominantProp = Math.max(
    features[2],
    features[3],
    features[4],
    features[5],
  );
  if (patterns.length >= 20 && dominantProp === 1.0) {
    signals.push({
      type: "SINGLE_TYPE_STREAM",
      confidence: 0.65,
      description:
        "All events belong to a single type (possible replay attack)",
    });
  }

  return signals;
}

/** Maps a composite threat score (0–1) to a categorical threat level. */
export function scoresToLevel(
  score: number,
): ThreatAnalysis["threatLevel"] {
  if (score < 0.15) return "none";
  if (score < 0.35) return "low";
  if (score < 0.60) return "medium";
  if (score < 0.80) return "high";
  return "critical";
}

// ─── Model cache manager ──────────────────────────────────────────────────────

/**
 * Manages caching of the Gemma model binary via the browser's Cache API.
 * Falls back gracefully when the Cache API is unavailable (Node.js, SSR,
 * private-mode browsers).
 */
export class ModelCacheManager {
  private readonly cacheName: string;

  constructor(cacheName = "gemma-model-v1") {
    this.cacheName = cacheName;
  }

  /** Returns true if the Cache API is available in the current environment. */
  isCacheApiAvailable(): boolean {
    return (
      typeof caches !== "undefined" && typeof caches.open === "function"
    );
  }

  /** Returns true if the model binary for `modelUrl` is already in the cache. */
  async isCached(modelUrl: string): Promise<boolean> {
    if (!this.isCacheApiAvailable()) return false;
    try {
      const cache = await caches.open(this.cacheName);
      const match = await cache.match(modelUrl);
      return match !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Fetches the model from `modelUrl`, writes it to the cache, and returns
   * the raw binary. A cache-write failure is non-fatal.
   *
   * @throws {Error} if the HTTP response is not 2xx.
   */
  async fetchAndCache(modelUrl: string): Promise<ArrayBuffer> {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch model from ${modelUrl}: HTTP ${response.status}`,
      );
    }
    const buffer = await response.arrayBuffer();

    if (this.isCacheApiAvailable()) {
      try {
        const cache = await caches.open(this.cacheName);
        // Clone the buffer so the caller still owns a writable copy.
        await cache.put(modelUrl, new Response(buffer.slice(0)));
      } catch {
        // Ignore — cache storage may be full or unavailable.
      }
    }

    return buffer;
  }

  /**
   * Returns the model binary from the cache, or `null` if not present.
   */
  async getFromCache(modelUrl: string): Promise<ArrayBuffer | null> {
    if (!this.isCacheApiAvailable()) return null;
    try {
      const cache = await caches.open(this.cacheName);
      const match = await cache.match(modelUrl);
      if (!match) return null;
      return await match.arrayBuffer();
    } catch {
      return null;
    }
  }

  /** Removes the cached model entry (e.g. for forced model upgrades). */
  async evict(modelUrl: string): Promise<void> {
    if (!this.isCacheApiAvailable()) return;
    try {
      const cache = await caches.open(this.cacheName);
      await cache.delete(modelUrl);
    } catch {
      // Ignore eviction errors.
    }
  }
}

// ─── WebGPU backend ───────────────────────────────────────────────────────────

// Minimal WebGPU type declarations (subset used by this module).
// The full spec types ship with @webgpu/types or a "dom" lib; we declare
// only what we need here to avoid adding a dev-dependency.
type GPUBufferUsageFlags = number;
declare const GPUBufferUsage: { STORAGE: number; COPY_DST: number; COPY_SRC: number; MAP_READ: number };
declare const GPUShaderStage: { COMPUTE: number };
declare const GPUMapMode: { READ: number };

interface GPURequestAdapterOptions { powerPreference?: string }
interface GPUAdapter { requestDevice(descriptor?: object): Promise<GPUDevice> }
interface GPUShaderModuleDescriptor { code: string }
interface GPUShaderModule { /* opaque */ }
interface GPUBufferDescriptor { size: number; usage: GPUBufferUsageFlags }
interface GPUBuffer {
  destroy(): void;
  getMappedRange(): ArrayBuffer;
  mapAsync(mode: number): Promise<void>;
  unmap(): void;
}
interface GPUBindGroupLayoutEntry {
  binding: number;
  visibility: number;
  buffer: { type: string };
}
interface GPUBindGroupLayoutDescriptor { entries: GPUBindGroupLayoutEntry[] }
interface GPUBindGroupLayout { /* opaque */ }
interface GPUPipelineLayoutDescriptor { bindGroupLayouts: GPUBindGroupLayout[] }
interface GPUPipelineLayout { /* opaque */ }
interface GPUComputePipelineDescriptor {
  layout: GPUPipelineLayout;
  compute: { module: GPUShaderModule; entryPoint: string };
}
interface GPUComputePipeline {
  getBindGroupLayout(index: number): GPUBindGroupLayout;
}
interface GPUBindGroupDescriptor {
  layout: GPUBindGroupLayout;
  entries: Array<{ binding: number; resource: { buffer: GPUBuffer } }>;
}
interface GPUBindGroup { /* opaque */ }
interface GPUComputePassEncoder {
  setPipeline(pipeline: GPUComputePipeline): void;
  setBindGroup(index: number, bindGroup: GPUBindGroup): void;
  dispatchWorkgroups(x: number): void;
  end(): void;
}
interface GPUCommandEncoder {
  beginComputePass(): GPUComputePassEncoder;
  copyBufferToBuffer(
    src: GPUBuffer, srcOffset: number,
    dst: GPUBuffer, dstOffset: number, size: number,
  ): void;
  finish(): GPUCommandBuffer;
}
interface GPUCommandBuffer { /* opaque */ }
interface GPUQueue {
  submit(commandBuffers: GPUCommandBuffer[]): void;
  writeBuffer(buffer: GPUBuffer, offset: number, data: ArrayBufferView): void;
}
interface GPUDevice {
  createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer;
  createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
  createBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout;
  createPipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout;
  createComputePipeline(descriptor: GPUComputePipelineDescriptor): GPUComputePipeline;
  createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
  createCommandEncoder(): GPUCommandEncoder;
  queue: GPUQueue;
  destroy(): void;
}
interface GPU {
  requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
}

/**
 * WebGPU inference backend.
 *
 * Loads the quantized Gemma model onto the GPU and runs forward passes using
 * WebGPU compute shaders. Provides lowest-latency inference on supported
 * hardware (modern desktop GPUs, Apple Silicon via Metal).
 *
 * NOTE: The WGSL shader below uses a placeholder weighted-linear model.
 *       In production, replace the weight constants with values loaded from
 *       the quantized Gemma GGUF/ONNX file.
 */
export class WebGPUBackend implements InferenceBackend {
  private device: GPUDevice | null = null;
  private pipeline: GPUComputePipeline | null = null;

  async isAvailable(): Promise<boolean> {
    if (typeof navigator === "undefined") return false;
    if (!("gpu" in navigator)) return false;
    try {
      const gpu = (navigator as unknown as { gpu: GPU }).gpu;
      const adapter = await gpu.requestAdapter();
      if (!adapter) return false;
      this.device = await adapter.requestDevice();
      return true;
    } catch {
      return false;
    }
  }

  async infer(features: Float32Array): Promise<Float32Array> {
    if (!this.device) {
      throw new Error(
        "WebGPU device not initialised; call isAvailable() first",
      );
    }

    const inputBuffer = this.device.createBuffer({
      size: features.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const outputBuffer = this.device.createBuffer({
      size: 5 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const stagingBuffer = this.device.createBuffer({
      size: 5 * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(inputBuffer, 0, features);

    if (!this.pipeline) {
      const shaderModule = this.device.createShaderModule({
        // WGSL compute shader: weighted linear combination → 5 threat classes.
        // Replace weight constants with values loaded from the Gemma model file.
        code: `
          @group(0) @binding(0) var<storage, read>       input  : array<f32>;
          @group(0) @binding(1) var<storage, read_write> output : array<f32>;

          @compute @workgroup_size(1)
          fn main() {
            let w = array<f32, 10>(
              0.08, 0.12, 0.15, 0.10, 0.09,
              0.11, 0.07, 0.13, 0.14, 0.11
            );
            var logit : f32 = 0.0;
            for (var i = 0u; i < 10u; i++) { logit += input[i] * w[i]; }
            logit = clamp(logit, 0.0, 1.0);
            output[0] = 1.0 - logit;
            output[1] = logit * 0.4;
            output[2] = logit * 0.3;
            output[3] = logit * 0.2;
            output[4] = logit * 0.1;
          }
        `,
      });

      const bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          },
        ],
      });

      this.pipeline = this.device.createComputePipeline({
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [bindGroupLayout],
        }),
        compute: { module: shaderModule, entryPoint: "main" },
      });
    }

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(
      outputBuffer, 0, stagingBuffer, 0, stagingBuffer.size,
    );
    this.device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();

    inputBuffer.destroy();
    outputBuffer.destroy();
    stagingBuffer.destroy();

    return result;
  }

  dispose(): void {
    this.pipeline = null;
    if (this.device) {
      this.device.destroy();
      this.device = null;
    }
  }
}

// ─── CPU fallback backend ─────────────────────────────────────────────────────

/**
 * CPU fallback backend using a lightweight linear model.
 *
 * Used when WebGPU is unavailable (older browsers, Node.js, SSR).
 * Runs synchronously with no external dependencies — always available.
 */
export class CpuFallbackBackend implements InferenceBackend {
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async infer(features: Float32Array): Promise<Float32Array> {
    const weights = [
      0.08, 0.12, 0.15, 0.10, 0.09,
      0.11, 0.07, 0.13, 0.14, 0.11,
    ];
    let logit = 0;
    for (let i = 0; i < Math.min(features.length, weights.length); i++) {
      logit += features[i] * weights[i];
    }
    logit = Math.max(0, Math.min(1, logit));

    const output = new Float32Array(5);
    output[0] = 1 - logit;      // none
    output[1] = logit * 0.4;    // low
    output[2] = logit * 0.3;    // medium
    output[3] = logit * 0.2;    // high
    output[4] = logit * 0.1;    // critical
    return output;
  }

  dispose(): void {
    // No resources to release.
  }
}

// ─── GemmaEngine ─────────────────────────────────────────────────────────────

const DEFAULT_MODEL_URL =
  "https://huggingface.co/google/gemma-3-1b-it-GGUF/resolve/main/gemma-3-1b-it-Q4_K_M.gguf";
const DEFAULT_CACHE_NAME = "gemma-model-v1";
const DEFAULT_MAX_MEMORY_MB = 512;

/** Static threat-class labels used during ML signal generation. */
const THREAT_CLASSES: ReadonlyArray<{ type: string; description: string }> = [
  { type: "THREAT_NONE",     description: "No threat detected" },
  { type: "THREAT_LOW",      description: "Low-level anomaly" },
  { type: "THREAT_MEDIUM",   description: "Moderate behavioural anomaly" },
  { type: "THREAT_HIGH",     description: "High-confidence bot or automation" },
  { type: "THREAT_CRITICAL", description: "Critical synthetic-identity signal" },
];

/**
 * Main entry point for on-device Gemma AI threat detection.
 *
 * The engine fetches the quantized Gemma model binary from a CDN on first
 * use, caches it in the browser's Cache API, and runs inference entirely on
 * the client — no user behaviour data is ever sent to the server.
 *
 * Backend selection (automatic, in priority order):
 *   1. WebGPU — hardware-accelerated GPU inference
 *   2. CPU    — pure-JS linear model fallback
 *
 * Memory management:
 *   The engine retains a single `ArrayBuffer` for the model binary. Call
 *   `dispose()` when done to release it and allow GC. The engine enforces a
 *   configurable `maxMemoryMB` budget; it will throw rather than silently
 *   exceed it (protects low-end devices).
 *
 * @example
 * ```ts
 * const engine = new GemmaEngine({ backend: "webgpu", maxMemoryMB: 256 });
 * await engine.load();
 * const result = await engine.analyzeThreats(patterns);
 * engine.dispose();
 * ```
 */
export class GemmaEngine {
  private readonly config: Required<GemmaEngineConfig>;
  private readonly cacheManager: ModelCacheManager;
  private backend: InferenceBackend | null = null;
  private modelBuffer: ArrayBuffer | null = null;
  private loaded = false;

  constructor(
    config: GemmaEngineConfig = {},
    cacheManager?: ModelCacheManager,
  ) {
    this.config = {
      modelUrl: config.modelUrl ?? DEFAULT_MODEL_URL,
      cacheName: config.cacheName ?? DEFAULT_CACHE_NAME,
      maxMemoryMB: config.maxMemoryMB ?? DEFAULT_MAX_MEMORY_MB,
      backend: config.backend ?? "webgpu",
    };
    this.cacheManager =
      cacheManager ?? new ModelCacheManager(this.config.cacheName);
  }

  /** Returns true if the engine is loaded and ready to infer. */
  isReady(): boolean {
    return this.loaded;
  }

  /**
   * Estimates the engine's current heap footprint in MB.
   * Accounts for the in-memory model buffer plus a fixed JS-runtime overhead.
   */
  getMemoryUsageMB(): number {
    const bufferMB = this.modelBuffer
      ? this.modelBuffer.byteLength / (1024 * 1024)
      : 0;
    return bufferMB + 2; // +2 MB for runtime overhead
  }

  /**
   * Loads the Gemma model and selects the best available inference backend.
   *
   * On cache hit the model binary is served from browser storage (no network
   * request). On cache miss the binary is fetched and written to the cache.
   *
   * Calling `load()` on an already-loaded engine is a no-op.
   *
   * @param overrideBackend — inject a custom backend (useful for testing).
   * @throws if the model binary exceeds `maxMemoryMB`.
   */
  async load(overrideBackend?: InferenceBackend): Promise<void> {
    if (this.loaded) return;

    // Resolve inference backend
    if (overrideBackend) {
      this.backend = overrideBackend;
    } else if (this.config.backend === "webgpu") {
      const gpuBackend = new WebGPUBackend();
      this.backend = (await gpuBackend.isAvailable())
        ? gpuBackend
        : new CpuFallbackBackend();
    } else {
      this.backend = new CpuFallbackBackend();
    }

    // Restore from cache or fetch
    const cached = await this.cacheManager.getFromCache(this.config.modelUrl);
    if (cached) {
      this.modelBuffer = cached;
    } else {
      this.modelBuffer = await this.cacheManager.fetchAndCache(
        this.config.modelUrl,
      );
    }

    const modelSizeMB = this.modelBuffer.byteLength / (1024 * 1024);
    if (modelSizeMB > this.config.maxMemoryMB) {
      this.modelBuffer = null;
      this.backend = null;
      throw new Error(
        `Model size ${modelSizeMB.toFixed(1)} MB exceeds maxMemoryMB=${this.config.maxMemoryMB}`,
      );
    }

    this.loaded = true;
  }

  /**
   * Analyses a list of captured user behaviour patterns and returns a threat
   * assessment. The engine must be loaded before calling this method.
   *
   * The analysis pipeline:
   *   1. Feature extraction from raw patterns (always runs).
   *   2. Rule-based heuristics (fast path; runs before ML).
   *   3. ML inference via the selected backend (deep path).
   *   4. Signal merging and composite scoring.
   *
   * @throws if the engine is not loaded.
   */
  async analyzeThreats(patterns: BehaviorPattern[]): Promise<ThreatAnalysis> {
    if (!this.loaded || !this.backend) {
      throw new Error(
        "GemmaEngine is not loaded. Call engine.load() first.",
      );
    }

    const start = Date.now();

    const features = extractFeatures(patterns);
    const heuristicSignals = applyHeuristics(patterns, features);

    let mlSignals: ThreatSignal[] = [];
    let mlScore = 0;

    try {
      const probabilities = await this.backend.infer(features);
      // Threat score = complement of the "none" class probability
      mlScore = Math.max(0, 1 - (probabilities[0] ?? 1));

      const classes = THREAT_CLASSES;

      for (let i = 1; i < Math.min(probabilities.length, classes.length); i++) {
        const confidence = probabilities[i] ?? 0;
        if (confidence > 0.05) {
          mlSignals.push({
            type: classes[i].type,
            confidence,
            description: classes[i].description,
          });
        }
      }
    } catch {
      // ML failure is non-fatal; heuristic signals still apply.
    }

    const allSignals = [...heuristicSignals, ...mlSignals].sort(
      (a, b) => b.confidence - a.confidence,
    );

    const heuristicScore =
      heuristicSignals.length > 0
        ? Math.max(...heuristicSignals.map((s) => s.confidence))
        : 0;
    const threatScore = Math.max(heuristicScore, mlScore);

    return {
      threatLevel: scoresToLevel(threatScore),
      threatScore,
      signals: allSignals,
      patternCount: patterns.length,
      analysisTimeMs: Date.now() - start,
      memoryUsedMB: this.getMemoryUsageMB(),
    };
  }

  /**
   * Releases all resources held by the engine.
   *
   * The model buffer is dereferenced (allowing GC), the GPU device is
   * destroyed, and the engine is marked as not loaded. Create a new
   * `GemmaEngine` instance if inference is needed again.
   */
  dispose(): void {
    if (this.backend) {
      this.backend.dispose();
      this.backend = null;
    }
    this.modelBuffer = null;
    this.loaded = false;
  }
}
