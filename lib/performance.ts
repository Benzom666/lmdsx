// Performance monitoring utilities
export class PerformanceMonitor {
  private static instance: PerformanceMonitor
  private metrics: Map<string, number> = new Map()

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor()
    }
    return PerformanceMonitor.instance
  }

  startTimer(name: string): void {
    this.metrics.set(name, performance.now())
  }

  endTimer(name: string): number {
    const startTime = this.metrics.get(name)
    if (!startTime) {
      console.warn(`Timer ${name} was not started`)
      return 0
    }

    const duration = performance.now() - startTime
    this.metrics.delete(name)

    console.log(`⏱️ ${name}: ${duration.toFixed(2)}ms`)
    return duration
  }

  measureAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return new Promise(async (resolve, reject) => {
      this.startTimer(name)
      try {
        const result = await fn()
        this.endTimer(name)
        resolve(result)
      } catch (error) {
        this.endTimer(name)
        reject(error)
      }
    })
  }

  measureSync<T>(name: string, fn: () => T): T {
    this.startTimer(name)
    try {
      const result = fn()
      this.endTimer(name)
      return result
    } catch (error) {
      this.endTimer(name)
      throw error
    }
  }

  getWebVitals(): void {
    if (typeof window !== "undefined" && "performance" in window) {
      // Measure Core Web Vitals
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          // Check if entry has value property (for certain performance entry types)
          if ('value' in entry && typeof entry.value === 'number') {
            console.log(`📊 ${entry.name}: ${entry.value}`)
          } else if ('duration' in entry && typeof entry.duration === 'number') {
            console.log(`📊 ${entry.name}: ${entry.duration}ms`)
          } else {
            console.log(`📊 ${entry.name}: ${entry.entryType}`)
          }
        }
      })

      observer.observe({ entryTypes: ["measure", "navigation", "paint"] })
    }
  }
}

export const performanceMonitor = PerformanceMonitor.getInstance()
