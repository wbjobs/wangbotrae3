import { generateId } from '@shared/utils';
import { SamplePhotoFull } from '@shared/types';

export async function capturePhoto(): Promise<SamplePhotoFull> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('未选择图片'));
        return;
      }

      try {
        const photo = await processImage(file);
        resolve(photo);
      } catch (error) {
        reject(error);
      }
    };

    input.onerror = () => {
      reject(new Error('无法打开相机'));
    };

    input.click();
  });
}

export async function selectPhoto(): Promise<SamplePhotoFull> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('未选择图片'));
        return;
      }

      try {
        const photo = await processImage(file);
        resolve(photo);
      } catch (error) {
        reject(error);
      }
    };

    input.onerror = () => {
      reject(new Error('无法选择图片'));
    };

    input.click();
  });
}

async function processImage(file: File): Promise<SamplePhotoFull> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxWidth = 1024;
        const maxHeight = 1024;
        
        let { width, height } = img;
        
        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width *= ratio;
          height *= ratio;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建画布'));
          return;
        }
        
        ctx.drawImage(img, 0, 0, width, height);
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        
        resolve({
          id: generateId(),
          data: dataUrl,
          name: file.name,
          timestamp: Date.now()
        });
      };
      
      img.onerror = () => {
        reject(new Error('无法加载图片'));
      };
      
      img.src = e.target?.result as string;
    };
    
    reader.onerror = () => {
      reject(new Error('无法读取文件'));
    };
    
    reader.readAsDataURL(file);
  });
}
