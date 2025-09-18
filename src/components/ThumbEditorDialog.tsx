"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  clampThumbTransform,
  DEFAULT_THUMB_TRANSFORM,
} from "@/lib/image-utils";
import type { ThumbTransform } from "@/lib/types";

type ThumbEditorDialogProps = {
  open: boolean;
  imageUrl: string;
  value: ThumbTransform;
  onApply: (value: ThumbTransform) => void;
  onClose: () => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
};

export default function ThumbEditorDialog({
  open,
  imageUrl,
  value,
  onApply,
  onClose,
}: ThumbEditorDialogProps) {
  const [local, setLocal] = useState<ThumbTransform>(() =>
    clampThumbTransform(value)
  );
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLocal(clampThumbTransform(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) {
      setImageLoaded(false);
      setImageError(null);
      dragStateRef.current = null;
      return;
    }
    setImageLoaded(false);
    setImageError(null);
  }, [open, imageUrl]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const hasImage = imageUrl.trim().length > 0;
  const canApply = hasImage && imageLoaded && !imageError;

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!hasImage || !imageLoaded) {
      return;
    }
    event.preventDefault();
    const container = containerRef.current;
    if (!container) {
      return;
    }
    container.setPointerCapture?.(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: local.offsetX,
      startOffsetY: local.offsetY,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    const deltaX = ((event.clientX - dragState.startX) / width) * 100;
    const deltaY = ((event.clientY - dragState.startY) / height) * 100;
    setLocal((prev) =>
      clampThumbTransform({
        ...prev,
        offsetX: dragState.startOffsetX + deltaX,
        offsetY: dragState.startOffsetY + deltaY,
      })
    );
  };

  const endDragging = (pointerId: number) => {
    const container = containerRef.current;
    if (container) {
      container.releasePointerCapture?.(pointerId);
    }
    dragStateRef.current = null;
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current && dragStateRef.current.pointerId === event.pointerId) {
      endDragging(event.pointerId);
    }
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current && dragStateRef.current.pointerId === event.pointerId) {
      endDragging(event.pointerId);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-gray-900">圖片編輯</h2>
            <p className="mt-1 text-sm text-gray-500">
              拖曳預覽以調整顯示位置，使用滑桿縮放圖片。此調整僅影響縮圖顯示範圍。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 rounded-full border border-gray-200 text-xl text-gray-500 transition hover:border-gray-300 hover:text-gray-700"
            aria-label="關閉圖片編輯視窗"
          >
            ×
          </button>
        </div>

        <div
          ref={containerRef}
          className="relative mx-auto mt-6 aspect-square w-full max-w-sm overflow-hidden rounded-2xl border border-gray-200 bg-gray-100"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        >
          {!hasImage ? (
            <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-gray-500">
              請先輸入縮圖連結後再進行圖片編輯。
            </div>
          ) : imageError ? (
            <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-red-600">
              {imageError}
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt="縮圖預覽"
                className="pointer-events-none select-none"
                style={{
                  width: "100%",
                  height: "100%",
                  transform: `translate(${local.offsetX}%, ${local.offsetY}%) scale(${local.scale})`,
                  transformOrigin: "center",
                  objectFit: "cover",
                }}
                draggable={false}
                onLoad={() => {
                  setImageLoaded(true);
                  setImageError(null);
                }}
                onError={() => {
                  setImageLoaded(false);
                  setImageError("圖片載入失敗，請確認連結是否有效。");
                }}
              />
              {!imageLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60 text-sm text-gray-500">
                  圖片載入中…
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>縮放</span>
            <span className="tabular-nums text-gray-500">
              {local.scale.toFixed(2)} ×
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={local.scale}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isNaN(next)) {
                return;
              }
              setLocal((prev) =>
                clampThumbTransform({
                  ...prev,
                  scale: next,
                })
              );
            }}
            className="w-full"
            aria-label="縮放調整"
          />
          <div className="grid grid-cols-2 gap-3 text-xs text-gray-500 sm:grid-cols-3">
            <div>水平位移：{local.offsetX.toFixed(0)}%</div>
            <div>垂直位移：{local.offsetY.toFixed(0)}%</div>
            <div className="sm:col-span-1">縮放：{local.scale.toFixed(2)}×</div>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setLocal({ ...DEFAULT_THUMB_TRANSFORM })}
            className="inline-flex items-center justify-center rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-800"
          >
            重置顯示範圍
          </button>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:border-gray-300 hover:text-gray-800"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!canApply}
              onClick={() => {
                if (!canApply) {
                  return;
                }
                onApply(clampThumbTransform(local));
              }}
              className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition ${
                canApply
                  ? "bg-gray-900 text-white hover:bg-black"
                  : "cursor-not-allowed bg-gray-300 text-gray-500"
              }`}
            >
              套用調整
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
