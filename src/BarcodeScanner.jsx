import React, { useEffect, useRef, useState } from "react";
import { X, Loader2, AlertCircle, ScanLine } from "lucide-react";

// Two decoders, because no browser on iOS implements the Barcode Detection
// API — a native-only scanner would silently never fire on an iPhone. Chrome
// on Android gets the fast native path; everyone else gets ZXing, which is
// pure JS and works anywhere getUserMedia does. ZXing is loaded on demand so
// its ~300KB never touches the initial page load.
async function startNativeDetector(video, onCode, signal) {
  const detector = new window.BarcodeDetector({
    formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"],
  });
  const tick = async () => {
    if (signal.stopped) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length && codes[0].rawValue) return onCode(codes[0].rawValue);
    } catch { /* a frame that won't decode is normal; keep going */ }
    signal.raf = requestAnimationFrame(tick);
  };
  tick();
  return () => { signal.stopped = true; cancelAnimationFrame(signal.raf); };
}

async function startZxing(video, onCode, signal) {
  const { BrowserMultiFormatReader } = await import("@zxing/browser");
  if (signal.stopped) return () => {};
  const reader = new BrowserMultiFormatReader();
  const controls = await reader.decodeFromVideoElement(video, (result) => {
    if (result && !signal.stopped) onCode(result.getText());
  });
  return () => { signal.stopped = true; try { controls.stop(); } catch { /* already stopped */ } };
}

export default function BarcodeScanner({ onDetected, onClose, busy, error }) {
  const videoRef = useRef(null);
  const [camError, setCamError] = useState("");
  const [starting, setStarting] = useState(true);
  const handledRef = useRef(false);

  useEffect(() => {
    const signal = { stopped: false, raf: 0 };
    let stopDecoder = () => {};
    let stream = null;

    (async () => {
      try {
        // The rear camera is the one pointed at the package.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (signal.stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute("playsinline", "true"); // iOS won't inline-play without it
        await video.play();
        setStarting(false);

        const handle = (code) => {
          if (handledRef.current) return;
          handledRef.current = true;
          onDetected(code);
        };

        stopDecoder = "BarcodeDetector" in window
          ? await startNativeDetector(video, handle, signal)
          : await startZxing(video, handle, signal);
      } catch (e) {
        setStarting(false);
        setCamError(
          e?.name === "NotAllowedError"
            ? "Camera access is blocked — allow it for this site in Safari's settings, or search for the food by name instead."
            : `Couldn't start the camera: ${e?.message || "unknown error"}`
        );
      }
    })();

    return () => {
      signal.stopped = true;
      try { stopDecoder(); } catch { /* nothing to stop */ }
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [onDetected]);

  return (
    <div className="scanner-backdrop">
      <div className="scanner-frame">
        <div className="scanner-head">
          <span><ScanLine size={15} /> Point at the barcode</span>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
        </div>
        <div className="scanner-video-wrap">
          <video ref={videoRef} className="scanner-video" muted playsInline />
          <div className="scanner-reticle" />
          {(starting || busy) && (
            <div className="scanner-overlay">
              <Loader2 size={20} className="spin" />
              <span>{busy ? "Looking it up…" : "Starting camera…"}</span>
            </div>
          )}
        </div>
        {(camError || error) && (
          <div className="scanner-error"><AlertCircle size={13} /> {camError || error}</div>
        )}
        <div className="scanner-hint">
          Hold steady about a hand's width away. If it won't catch, close this and search by name.
        </div>
      </div>
    </div>
  );
}
