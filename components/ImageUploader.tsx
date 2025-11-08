import React, { useRef } from 'react';
import { UploadIcon } from './icons/UploadIcon';
import { TrashIcon } from './icons/TrashIcon';

interface ImageUploaderProps {
  onImageSelect: (base64Image: string) => void;
  onImageRemove: () => void;
  imagePreviewUrl: string | null;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  onImageSelect,
  onImageRemove,
  imagePreviewUrl,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) { // 4MB limit
        alert("Kích thước file ảnh không được vượt quá 4MB.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        onImageSelect(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/png, image/jpeg, image/webp"
        className="hidden"
      />
      <label className="block text-sm font-semibold text-text-primary mb-2">Ảnh tham chiếu (Tùy chọn)</label>
      {imagePreviewUrl ? (
        <div className="relative group">
          <img src={imagePreviewUrl} alt="Preview" className="w-full max-h-48 object-contain rounded-lg border border-border" />
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
            <button
              onClick={onImageRemove}
              className="p-2 bg-red-600 hover:bg-red-500 text-white rounded-full transition-transform hover:scale-110"
              aria-label="Remove image"
            >
              <TrashIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={triggerFileInput}
          className="w-full flex flex-col items-center justify-center border-2 border-dashed border-border hover:border-accent rounded-lg p-6 transition-colors"
        >
          <UploadIcon className="w-8 h-8 text-text-secondary mb-2" />
          <span className="text-sm text-text-primary font-semibold">Tải lên ảnh</span>
          <span className="text-xs text-text-secondary mt-1">PNG, JPG, WEBP (Tối đa 4MB)</span>
        </button>
      )}
       <p className="text-xs text-text-secondary mt-1">Cung cấp ảnh để AI học theo phong cách (màu sắc, không khí...).</p>
    </div>
  );
};