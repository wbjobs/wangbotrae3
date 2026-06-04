use anyhow::{Context, Result};
use wasmtime::*;

const WASM_BYTES: &[u8] = include_bytes!(env!("CARGO_MANIFEST_DIR", "/wasm/style_transfer.wasm"));

#[derive(Clone)]
pub struct StyleTransferEngine {
    engine: Engine,
    module: Module,
}

impl StyleTransferEngine {
    pub fn new(_wasm_path: &str) -> Result<Self> {
        let engine = Engine::default();
        let module = Module::from_binary(&engine, WASM_BYTES)
            .context("Failed to load embedded WASM module")?;
        
        Ok(Self { engine, module })
    }
    
    pub fn create_instance(&self) -> Result<StyleTransferInstance> {
        let mut store = Store::new(&self.engine, ());
        let instance = Instance::new(&mut store, &self.module, &[])?;
        
        let malloc = instance
            .get_typed_func::<i32, i32, _>(&mut store, "malloc")?;
        let free = instance
            .get_typed_func::<i32, (), _>(&mut store, "free")?;
        let init_style = instance
            .get_typed_func::<(i32, i32, i32), (), _>(&mut store, "init_style")?;
        let transfer_frame = instance
            .get_typed_func::<(i32, i32, i32, i32, f32), (), _>(&mut store, "process_frame_fast")?;
            
        Ok(StyleTransferInstance {
            store,
            instance,
            malloc,
            free,
            init_style,
            transfer_frame,
            memory: instance.get_memory(&mut store, "memory").context("No memory exported")?,
        })
    }
}

pub struct StyleTransferInstance {
    store: Store<()>,
    instance: Instance,
    malloc: TypedFunc<i32, i32>,
    free: TypedFunc<i32, ()>,
    init_style: TypedFunc<(i32, i32, i32), ()>,
    transfer_frame: TypedFunc<(i32, i32, i32, i32, f32), ()>,
    memory: Memory,
}

impl StyleTransferInstance {
    pub fn init_style(&mut self, style_image: &[u8], width: usize, height: usize) -> Result<()> {
        let data_ptr = self.alloc_and_copy(style_image)?;
        self.init_style.call(&mut self.store, (data_ptr, width as i32, height as i32))?;
        self.free.call(&mut self.store, data_ptr)?;
        Ok(())
    }
    
    pub fn transfer_frame(&mut self, input: &[u8], output: &mut [u8], 
                          width: usize, height: usize, strength: f32) -> Result<()> {
        let input_ptr = self.alloc_and_copy(input)?;
        let output_ptr = self.malloc.call(&mut self.store, output.len() as i32)?;
        
        self.transfer_frame.call(&mut self.store, 
            (input_ptr, output_ptr, width as i32, height as i32, strength))?;
        
        let data = self.memory.data(&self.store);
        let output_offset = output_ptr as usize;
        output.copy_from_slice(&data[output_offset..output_offset + output.len()]);
        
        self.free.call(&mut self.store, input_ptr)?;
        self.free.call(&mut self.store, output_ptr)?;
        Ok(())
    }
    
    fn alloc_and_copy(&mut self, data: &[u8]) -> Result<i32> {
        let ptr = self.malloc.call(&mut self.store, data.len() as i32)?;
        let mem_data = self.memory.data_mut(&mut self.store);
        let offset = ptr as usize;
        mem_data[offset..offset + data.len()].copy_from_slice(data);
        Ok(ptr)
    }
}

unsafe impl Send for StyleTransferInstance {}
unsafe impl Sync for StyleTransferInstance {}
