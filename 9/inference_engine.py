import logging
import numpy as np
from pathlib import Path
from typing import Optional, Tuple
import cv2

from config import PrecisionType, ModelType, ScaleFactor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    import onnxruntime as ort
    ONNXRUNTIME_AVAILABLE = True
except ImportError:
    ONNXRUNTIME_AVAILABLE = False
    logger.warning("ONNX Runtime not available")

try:
    import tensorrt as trt
    import pycuda.driver as cuda
    import pycuda.autoinit
    TENSORRT_AVAILABLE = True
except ImportError:
    TENSORRT_AVAILABLE = False
    logger.warning("TensorRT not available")


class InferenceEngine:
    def __init__(
        self,
        model_path: str,
        precision: PrecisionType = "fp32",
        use_tensorrt: bool = False
    ):
        self.model_path = Path(model_path)
        self.precision = precision
        self.use_tensorrt = use_tensorrt and TENSORRT_AVAILABLE
        
        self.session = None
        self.trt_engine = None
        self.trt_context = None
        self.input_name = None
        self.output_name = None
        self.input_shape = None
        
        self._initialize()
    
    def _initialize(self):
        if self.use_tensorrt and TENSORRT_AVAILABLE:
            self._init_tensorrt()
        elif ONNXRUNTIME_AVAILABLE:
            self._init_onnxruntime()
        else:
            raise RuntimeError("No inference backend available")
    
    def _init_onnxruntime(self):
        logger.info(f"Initializing ONNX Runtime with {self.precision} precision")
        
        providers = []
        if self.precision in ["fp16", "int8"]:
            providers.append("TensorrtExecutionProvider")
        providers.extend(["CUDAExecutionProvider", "CPUExecutionProvider"])
        
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        
        if self.precision == "fp16":
            sess_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        
        self.session = ort.InferenceSession(
            str(self.model_path),
            sess_options=sess_options,
            providers=providers
        )
        
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name
        self.input_shape = self.session.get_inputs()[0].shape
        
        logger.info(f"ONNX Runtime initialized with providers: {self.session.get_providers()}")
    
    def _init_tensorrt(self):
        logger.info(f"Initializing TensorRT with {self.precision} precision")
        
        trt_logger = trt.Logger(trt.Logger.WARNING)
        builder = trt.Builder(trt_logger)
        network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH))
        parser = trt.OnnxParser(network, trt_logger)
        
        with open(self.model_path, 'rb') as model_file:
            if not parser.parse(model_file.read()):
                logger.error("Failed to parse ONNX model, falling back to ONNX Runtime")
                self.use_tensorrt = False
                self._init_onnxruntime()
                return
        
        config = builder.create_builder_config()
        config.max_workspace_size = 1 << 30
        
        if self.precision == "fp16" and builder.platform_has_fast_fp16:
            config.set_flag(trt.BuilderFlag.FP16)
        elif self.precision == "int8" and builder.platform_has_fast_int8:
            config.set_flag(trt.BuilderFlag.INT8)
            calibrator = self._create_calibrator()
            if calibrator:
                config.int8_calibrator = calibrator
        
        serialized_engine = builder.build_serialized_network(network, config)
        self.trt_engine = trt.Runtime(trt_logger).deserialize_cuda_engine(serialized_engine)
        self.trt_context = self.trt_engine.create_execution_context()
        
        self.input_name = self.trt_engine[0]
        self.output_name = self.trt_engine[1]
        self.input_shape = self.trt_engine.get_tensor_shape(self.input_name)
        
        logger.info("TensorRT engine initialized successfully")
    
    def _create_calibrator(self):
        return None
    
    def preprocess(self, image: np.ndarray) -> np.ndarray:
        if len(image.shape) == 2:
            image = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
        elif image.shape[2] == 4:
            image = cv2.cvtColor(image, cv2.COLOR_BGRA2RGB)
        elif image.shape[2] == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        image = image.astype(np.float32) / 255.0
        
        image = np.transpose(image, (2, 0, 1))
        image = np.expand_dims(image, axis=0)
        
        return image
    
    def postprocess(self, output: np.ndarray) -> np.ndarray:
        output = np.squeeze(output)
        output = np.transpose(output, (1, 2, 0))
        
        output = np.clip(output, 0, 1)
        output = (output * 255).astype(np.uint8)
        
        output = cv2.cvtColor(output, cv2.COLOR_RGB2BGR)
        
        return output
    
    def infer(self, image: np.ndarray) -> np.ndarray:
        preprocessed = self.preprocess(image)
        
        if self.use_tensorrt and self.trt_engine:
            result = self._infer_tensorrt(preprocessed)
        else:
            result = self._infer_onnxruntime(preprocessed)
        
        return self.postprocess(result)
    
    def _infer_onnxruntime(self, input_data: np.ndarray) -> np.ndarray:
        outputs = self.session.run(
            [self.output_name],
            {self.input_name: input_data}
        )
        return outputs[0]
    
    def _infer_tensorrt(self, input_data: np.ndarray) -> np.ndarray:
        input_data = np.ascontiguousarray(input_data)
        output_shape = self.trt_engine.get_tensor_shape(self.output_name)
        output_data = np.empty(output_shape, dtype=np.float32)
        
        d_input = cuda.mem_alloc(input_data.nbytes)
        d_output = cuda.mem_alloc(output_data.nbytes)
        
        cuda.memcpy_htod(d_input, input_data)
        
        self.trt_context.set_tensor_address(self.input_name, int(d_input))
        self.trt_context.set_tensor_address(self.output_name, int(d_output))
        
        self.trt_context.execute_async_v3(0)
        
        cuda.memcpy_dtoh(output_data, d_output)
        
        d_input.free()
        d_output.free()
        
        return output_data
    
    def get_inference_time(self, image: np.ndarray) -> float:
        import time
        start = time.time()
        self.infer(image)
        return time.time() - start
    
    def cleanup(self):
        if self.session:
            self.session = None
        if self.trt_context:
            self.trt_context = None
        if self.trt_engine:
            self.trt_engine = None


class InferenceEngineFactory:
    _engines = {}
    
    @classmethod
    def get_engine(
        cls,
        model_type: ModelType,
        scale: ScaleFactor,
        precision: PrecisionType,
        use_tensorrt: bool = False
    ) -> InferenceEngine:
        key = (model_type, scale, precision, use_tensorrt)
        
        if key not in cls._engines:
            from config import ESPCN_MODELS, EDSR_MODELS
            
            models = ESPCN_MODELS if model_type == "espcn" else EDSR_MODELS
            model_path = models[scale]
            
            if not model_path.exists():
                logger.warning(f"Model file not found: {model_path}, using dummy model")
                cls._engines[key] = DummyInferenceEngine(model_path, precision, use_tensorrt, scale)
            else:
                cls._engines[key] = InferenceEngine(
                    str(model_path), precision, use_tensorrt
                )
        
        return cls._engines[key]
    
    @classmethod
    def cleanup_all(cls):
        for engine in cls._engines.values():
            engine.cleanup()
        cls._engines.clear()


class DummyInferenceEngine(InferenceEngine):
    def __init__(self, model_path: str, precision: PrecisionType, use_tensorrt: bool, scale: int):
        self.scale = scale
        self.precision = precision
        self.use_tensorrt = use_tensorrt
        logger.info(f"Dummy inference engine initialized with scale {scale}x")
    
    def infer(self, image: np.ndarray) -> np.ndarray:
        h, w = image.shape[:2]
        new_h, new_w = h * self.scale, w * self.scale
        
        result = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
        
        return result
    
    def get_inference_time(self, image: np.ndarray) -> float:
        return 0.01
    
    def cleanup(self):
        pass
