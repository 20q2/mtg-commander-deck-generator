import * as React from "react"
import { cn } from "@/lib/utils"

interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value?: number
  min?: number
  max?: number
  step?: number
  onChange?: (value: number) => void
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value = 50, min = 0, max = 100, step = 1, onChange, ...props }, ref) => {
    // Ensure min/max always encompass the value to avoid native range clamping issues
    const effectiveMin = Math.min(value, min)
    const effectiveMax = Math.max(value, max)
    const percentage = ((value - effectiveMin) / (effectiveMax - effectiveMin)) * 100

    return (
      <div className={cn("relative w-full", className)}>
        <input
          type="range"
          ref={ref}
          min={effectiveMin}
          max={effectiveMax}
          value={value}
          step={step}
          onChange={(e) => onChange?.(Number(e.target.value))}
          className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) ${percentage}%, hsl(var(--secondary)) ${percentage}%)`,
          }}
          {...props}
        />
      </div>
    )
  }
)
Slider.displayName = "Slider"

export { Slider }
