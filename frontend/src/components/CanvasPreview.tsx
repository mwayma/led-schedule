import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RefreshCw, FlipHorizontal } from 'lucide-react';

interface EffectConfig {
  type: string;
  name: string;
  speed?: number;
  waveFrequency?: number;
  ballCount?: number;
  mirrored?: boolean;
  erase?: boolean;
  color?: string | { r: number; g: number; b: number };
  palette?: {
    colors: Array<{ r: number; g: number; b: number } | string>;
    blend?: boolean;
  };
  ledScrollSpeed?: number;
  everyNthDot?: number;
  dotSize?: number;
  density?: number;
  ledColorPerSecond?: number;
  brightness?: number;
}

interface CanvasPreviewProps {
  width: number;
  height: number;
  effect: EffectConfig | null;
  fps?: number;
}

// Helper: HSV to RGB conversion (h in [0, 1])
const hsv2rgb = (h: number, s = 1, v = 1) => {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
};

// Helper: Parse Hex or RGB color object to CSS RGB string
const parseColor = (col: any): { r: number; g: number; b: number } => {
  if (!col) return { r: 0, g: 0, b: 0 };
  if (typeof col === 'string') {
    if (col.startsWith('#')) {
      const hex = col.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return { r, g, b };
    }
    return { r: 255, g: 0, b: 255 }; // fallback
  }
  return {
    r: typeof col.r === 'number' ? col.r : 0,
    g: typeof col.g === 'number' ? col.g : 0,
    b: typeof col.b === 'number' ? col.b : 0
  };
};

export const CanvasPreview: React.FC<CanvasPreviewProps> = ({
  width: initialWidth,
  height: initialHeight,
  effect,
  fps = 30
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [fpsCounter, setFpsCounter] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  
  // Safe defaults
  const width = Math.max(initialWidth || 64, 1);
  const height = Math.max(initialHeight || 1, 1);

  // States for specific animations
  const bouncingBallsRef = useRef<{
    heights: number[];
    velocities: number[];
    dampening: number[];
    timeSinceBounce: number[];
    colors: { r: number; g: number; b: number }[];
  } | null>(null);

  const starfieldRef = useRef<{
    x: number[];
    y: number[];
    brightness: number[];
    speed: number[];
  } | null>(null);

  const hueRef = useRef<number>(0);
  const scrollOffsetRef = useRef<number>(0);

  // Re-initialize effect states when effect changes
  useEffect(() => {
    // Reset state values
    hueRef.current = 0;
    scrollOffsetRef.current = 0;
    
    if (!effect) return;

    // Initialize Bouncing Balls
    if (effect.type.includes('BouncingBallEffect')) {
      const ballCount = effect.ballCount || 5;
      const Gravity = -0.25;
      const StartHeight = 1.0;
      const ImpactVelocityStart = Math.sqrt(-2.0 * Gravity * StartHeight);
      
      const heights = Array(ballCount).fill(StartHeight);
      const velocities = Array(ballCount).fill(ImpactVelocityStart);
      const timeSinceBounce = Array(ballCount).fill(0);
      const dampening = Array.from({ length: ballCount }, (_, i) => 
        1.0 - i / Math.pow(ballCount, 2)
      );
      
      const ballColors = [
        { r: 0, g: 255, b: 0 },   // Green
        { r: 255, g: 0, b: 0 },   // Red
        { r: 0, g: 0, b: 255 },   // Blue
        { r: 255, g: 165, b: 0 }, // Orange
        { r: 128, g: 0, b: 128 }, // Purple
        { r: 255, g: 255, b: 0 }, // Yellow
        { r: 75, g: 0, b: 130 }   // Indigo
      ];
      
      const colors = Array.from({ length: ballCount }, (_, i) => 
        ballColors[i % ballColors.length] || { r: 255, g: 255, b: 255 }
      );

      bouncingBallsRef.current = { heights, velocities, dampening, timeSinceBounce, colors };
    }

    // Initialize Starfield
    if (effect.type.includes('StarfieldEffect')) {
      const starCount = 30;
      const x = Array.from({ length: starCount }, () => Math.random() * width);
      const y = Array.from({ length: starCount }, () => Math.random() * height);
      const brightness = Array.from({ length: starCount }, () => Math.random());
      const speed = Array.from({ length: starCount }, () => 0.01 + Math.random() * 0.04);
      starfieldRef.current = { x, y, brightness, speed };
    }
  }, [effect, width, height]);

  // Effect update and render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let framesThisSecond = 0;
    let lastFpsUpdateTime = 0;

    const render = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const delta = timestamp - lastTimeRef.current;
      
      // Enforce FPS target
      const frameDuration = 1000 / fps;
      if (delta < frameDuration) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      lastTimeRef.current = timestamp;
      framesThisSecond++;

      if (timestamp - lastFpsUpdateTime >= 1000) {
        setFpsCounter(framesThisSecond);
        framesThisSecond = 0;
        lastFpsUpdateTime = timestamp;
      }

      // Draw background / clear
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (!effect) {
        // Draw standby pulse
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        const type = effect.type;
        const speed = effect.speed !== undefined ? effect.speed : 0.5;

        // 1. Color Wave Effect
        if (type.includes('ColorWaveEffect')) {
          const waveFreq = effect.waveFrequency || 10.0;
          hueRef.current += (speed * frameDuration) / 1000.0;
          if (hueRef.current >= 1.0) hueRef.current -= 1.0;

          const pixelW = canvas.width / width;
          const pixelH = canvas.height / height;

          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              let localHue = hueRef.current + (x / width) * waveFreq;
              if (localHue > 1.0) localHue -= 1.0;
              const rgb = hsv2rgb(localHue);
              ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
              const drawX = isFlipped ? (width - 1 - x) : x;
              ctx.fillRect(drawX * pixelW, y * pixelH, pixelW - 1, pixelH - 1);
            }
          }
        } 
        // 2. Bouncing Ball Effect
        else if (type.includes('BouncingBallEffect') && bouncingBallsRef.current) {
          const balls = bouncingBallsRef.current;
          const Gravity = -0.25;
          const StartHeight = 1.0;
          const ImpactVelocityStart = Math.sqrt(-2.0 * Gravity * StartHeight);
          const erase = effect.erase !== false;
          const mirrored = effect.mirrored !== false;
          const ballCount = effect.ballCount || 5;

          const pixelW = canvas.width / width;
          const pixelH = canvas.height / height;

          // Clear or fade
          if (!erase) {
            ctx.fillStyle = 'rgba(5, 7, 12, 0.2)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          // Update physics
          const dt = frameDuration / 1000.0;
          for (let i = 0; i < ballCount; i++) {
            balls.timeSinceBounce[i] += dt;
            balls.heights[i] = 0.5 * Gravity * Math.pow(balls.timeSinceBounce[i], 2) + balls.velocities[i] * balls.timeSinceBounce[i];

            if (balls.heights[i] < 0) {
              balls.heights[i] = 0;
              balls.velocities[i] *= balls.dampening[i];
              balls.timeSinceBounce[i] = 0;

              if (balls.velocities[i] < 0.5 * ImpactVelocityStart) {
                balls.velocities[i] = ImpactVelocityStart;
              }
            }

            const xPos = Math.round(balls.heights[i] * (width - 1) / StartHeight);
            const drawX = isFlipped ? (width - 1 - xPos) : xPos;
            const rgb = balls.colors[i] || { r: 255, g: 255, b: 255 };

            ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
            ctx.fillRect(drawX * pixelW, 0, pixelW - 1, pixelH - 1);

            if (mirrored) {
              const mirX = width - 1 - drawX;
              ctx.fillRect(mirX * pixelW, 0, pixelW - 1, pixelH - 1);
            }
          }
        } 
        // 3. Solid Color Fill
        else if (type.includes('SolidColorFill')) {
          const rgb = parseColor(effect.color);
          ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        // 4. Palette Effect
        else if (type.includes('PaletteEffect') && effect.palette) {
          const everyNth = effect.everyNthDot !== undefined ? effect.everyNthDot : 1.0;
          const dotSize = effect.dotSize !== undefined ? effect.dotSize : 1.0;
          const mirrored = effect.mirrored === true; // mirroring flag

          // Initialize color buffer for the canvas strip (1D)
          const buffer = Array.from({ length: width }, () => ({ r: 0, g: 0, b: 0 }));

          const scrollSpeed = effect.ledScrollSpeed !== undefined ? effect.ledScrollSpeed : 5.0;
          scrollOffsetRef.current = (scrollOffsetRef.current + scrollSpeed * (frameDuration / 1000.0)) % width;
          
          const colors = effect.palette.colors.map(c => parseColor(c));
          const blend = effect.palette.blend !== false;
          const density = effect.density !== undefined ? effect.density : 1.0;
          const cLength = mirrored ? Math.floor(width / 2) : width;
          const cCenter = width / 2.0;

          if (colors.length > 0) {
            const colorIncrement = density / colors.length;
            const colorPerSec = effect.ledColorPerSecond !== undefined ? effect.ledColorPerSecond : 1.0;
            hueRef.current = (hueRef.current + (colorPerSec * (frameDuration / 1000.0) * density)) % 1.0;

            let currentIColor = hueRef.current;

            for (let i = 0; i < cLength; i += everyNth) {
              const iPixel = (i + scrollOffsetRef.current) % cLength;
              
              // Calculate color at currentIColor
              let c = { r: 0, g: 0, b: 0 };
              if (blend && colors.length > 1) {
                const floatIdx = currentIColor * colors.length;
                const idx1 = Math.floor(floatIdx) % colors.length;
                const idx2 = (idx1 + 1) % colors.length;
                const frac = floatIdx - Math.floor(floatIdx);
                
                const c1 = colors[idx1]!;
                const c2 = colors[idx2]!;
                c = {
                  r: Math.round(c1.r + frac * (c2.r - c1.r)),
                  g: Math.round(c1.g + frac * (c2.g - c1.g)),
                  b: Math.round(c1.b + frac * (c2.b - c1.b))
                };
              } else {
                const idx = Math.floor(currentIColor * colors.length) % colors.length;
                c = colors[idx] || { r: 0, g: 0, b: 0 };
              }

              // Apply brightness
              const brightness = effect.brightness !== undefined ? effect.brightness : 1.0;
              c = {
                r: Math.round(c.r * brightness),
                g: Math.round(c.g * brightness),
                b: Math.round(c.b * brightness)
              };

              // Set pixels in buffer
              for (let dx = 0; dx < dotSize; dx++) {
                const targetPixel = Math.floor(iPixel + dx) % cLength;
                
                const p1 = Math.floor(targetPixel + (mirrored ? cCenter : 0)) % width;
                if (p1 >= 0 && p1 < width) {
                  buffer[p1] = c;
                }

                if (mirrored) {
                  const p2 = Math.floor(cCenter - targetPixel) % width;
                  const safeP2 = p2 < 0 ? p2 + width : p2;
                  if (safeP2 >= 0 && safeP2 < width) {
                    buffer[safeP2] = c;
                  }
                }
              }

              currentIColor = (currentIColor + colorIncrement) % 1.0;
            }
          }

          // Render buffer to canvas
          const pixelW = canvas.width / width;
          const pixelH = canvas.height / height;

          for (let x = 0; x < width; x++) {
            const c = buffer[x]!;
            ctx.fillStyle = `rgb(${c.r}, ${c.g}, ${c.b})`;
            const drawX = isFlipped ? (width - 1 - x) : x;
            for (let y = 0; y < height; y++) {
              ctx.fillRect(drawX * pixelW, y * pixelH, pixelW - 1, pixelH - 1);
            }
          }
        }
        // 5. Starfield Effect
        else if (type.includes('StarfieldEffect') && starfieldRef.current) {
          const stars = starfieldRef.current;
          const pixelW = canvas.width / width;
          const pixelH = canvas.height / height;

          for (let i = 0; i < stars.x.length; i++) {
            stars.brightness[i] -= stars.speed[i]!;
            if (stars.brightness[i]! <= 0) {
              stars.brightness[i] = 1.0;
              stars.x[i] = Math.random() * width;
              stars.y[i] = Math.random() * height;
            }

            const intensity = Math.round(stars.brightness[i]! * 255);
            ctx.fillStyle = `rgb(${intensity}, ${intensity}, ${intensity})`;
            const drawX = isFlipped ? (width - 1 - Math.floor(stars.x[i]!)) : Math.floor(stars.x[i]!);
            ctx.fillRect(drawX * pixelW, Math.floor(stars.y[i]!) * pixelH, pixelW - 1, pixelH - 1);
          }
        }
        // Generic Fallback
        else {
          // Purple/Cyan pulse to indicate running unsupported effect
          const pulse = Math.abs(Math.sin(timestamp / 500));
          ctx.fillStyle = `rgba(168, 85, 247, ${0.1 + pulse * 0.3})`;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          ctx.fillStyle = '#06b6d4';
          ctx.font = '10px sans-serif';
          ctx.fillText(`Effect: ${effect.name || effect.type}`, 10, canvas.height - 10);
        }
      }

      // Draw grid lines to represent actual LEDs (if size is small enough)
      const pixelW = canvas.width / width;
      const pixelH = canvas.height / height;

      if (pixelW >= 4) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.lineWidth = 0.5;
        
        // Draw vertical grid lines
        for (let x = 0; x <= width; x++) {
          ctx.beginPath();
          ctx.moveTo(x * pixelW, 0);
          ctx.lineTo(x * pixelW, canvas.height);
          ctx.stroke();
        }

        // Draw horizontal grid lines
        for (let y = 0; y <= height; y++) {
          ctx.beginPath();
          ctx.moveTo(0, y * pixelH);
          ctx.lineTo(canvas.width, y * pixelH);
          ctx.stroke();
        }
      }

      if (isPlaying) {
        animationRef.current = requestAnimationFrame(render);
      }
    };

    if (isPlaying) {
      animationRef.current = requestAnimationFrame(render);
    } else {
      // Draw static display when paused
      ctx.fillStyle = '#070a13';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [effect, isPlaying, width, height, fps, isFlipped]);

  return (
    <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
            LED Preview Canvas
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Layout: {width}x{height} LEDs | {fpsCounter} FPS
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button 
            className="btn-icon" 
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? 'Pause simulation' : 'Start simulation'}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button 
            className="btn-icon" 
            onClick={() => setIsFlipped(!isFlipped)}
            style={{ 
              background: isFlipped ? 'var(--color-primary-glow)' : 'transparent',
              borderColor: isFlipped ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.05)',
              color: isFlipped ? 'var(--color-primary)' : 'var(--text-secondary)'
            }}
            title={isFlipped ? 'Normal orientation' : 'Flip preview horizontally'}
          >
            <FlipHorizontal size={14} />
          </button>
          <button 
            className="btn-icon" 
            onClick={() => {
              hueRef.current = 0;
              scrollOffsetRef.current = 0;
            }}
            title="Reset simulation"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div style={{ 
        position: 'relative', 
        background: '#04060b',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: '8px', 
        padding: '8px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        minHeight: '80px',
        overflow: 'hidden'
      }}>
        <canvas
          ref={canvasRef}
          width={width * Math.max(1, Math.min(10, Math.floor(480 / width)))}
          height={Math.max(16, height * Math.max(1, Math.min(10, Math.floor(480 / width))))}
          style={{ 
            width: '100%',
            maxHeight: '180px', 
            objectFit: 'contain',
            borderRadius: '4px',
            boxShadow: effect ? '0 0 25px rgba(0, 242, 254, 0.07)' : 'none'
          }}
        />
      </div>

      {effect && (
        <div style={{ display: 'flex', gap: '8px', fontSize: '12px', alignItems: 'center' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-primary)', boxShadow: 'var(--shadow-glow)' }}></div>
          <span style={{ color: 'var(--text-secondary)' }}>Rendering: </span>
          <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{effect.name}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({effect.type.replace(/^\d+/, '')})</span>
        </div>
      )}
    </div>
  );
};
