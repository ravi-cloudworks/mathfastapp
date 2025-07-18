"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Camera, Upload, ArrowRight, X } from "lucide-react"

interface RevealStep {
  revealHeight: number // How much of the image to reveal (in pixels)
  description: string
}

export default function MathShortsCreator() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [revealSteps, setRevealSteps] = useState<RevealStep[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [isProcessingLines, setIsProcessingLines] = useState(false)
  const [imageDimensions, setImageDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Detect text lines to create reveal steps
  const detectTextLinesForReveal = useCallback(async (imageElement: HTMLImageElement) => {
    return new Promise<RevealStep[]>((resolve) => {
      const canvas = canvasRef.current
      if (!canvas) {
        resolve([])
        return
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve([])
        return
      }

      // Set canvas size to match image
      canvas.width = imageElement.naturalWidth
      canvas.height = imageElement.naturalHeight

      // Draw image to canvas
      ctx.drawImage(imageElement, 0, 0)

      // Get image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data

      // Convert to grayscale
      const grayData = new Uint8Array(canvas.width * canvas.height)
      for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
        grayData[i / 4] = gray < 128 ? 0 : 255 // Binary threshold
      }

      // Calculate horizontal projection (count of black pixels in each row)
      const horizontalProjection = new Array(canvas.height).fill(0)
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const idx = y * canvas.width + x
          if (grayData[idx] === 0) { // Black pixel (text)
            horizontalProjection[y]++
          }
        }
      }

      // Find text line boundaries
      const textLines: { start: number; end: number }[] = []
      let inTextLine = false
      let lineStart = 0
      const minTextDensity = Math.max(3, canvas.width * 0.01) // Minimum text per row

      for (let y = 0; y < horizontalProjection.length; y++) {
        const hasText = horizontalProjection[y] > minTextDensity

        if (hasText && !inTextLine) {
          // Start of a new text line
          inTextLine = true
          lineStart = y
        } else if (!hasText && inTextLine) {
          // End of current text line
          inTextLine = false
          textLines.push({ start: lineStart, end: y })
        }
      }

      // Handle case where image ends with text
      if (inTextLine) {
        textLines.push({ start: lineStart, end: canvas.height })
      }

      // Filter out very small lines and merge close ones
      const filteredLines: { start: number; end: number }[] = []
      for (let i = 0; i < textLines.length; i++) {
        const line = textLines[i]
        if (line.end - line.start < 8) continue // Skip very small lines

        const nextLine = textLines[i + 1]
        if (nextLine && (nextLine.start - line.end) < 15) {
          // Merge with next line
          filteredLines.push({ start: line.start, end: nextLine.end })
          i++ // Skip next line
        } else {
          filteredLines.push(line)
        }
      }

      // Create reveal steps - each step reveals up to the end of a text line
      const steps: RevealStep[] = filteredLines.map((line, index) => ({
        revealHeight: line.end + 10, // Add small padding after each line
        description: `Step ${index + 1}`
      }))

      console.log('Detected text lines for reveal:', filteredLines)
      console.log('Created reveal steps:', steps)
      resolve(steps)
    })
  }, [])

  const handleImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file')
      return
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('Image too large. Please upload an image smaller than 10MB')
      return
    }

    const reader = new FileReader()
    reader.onloadend = async () => {
      try {
        const dataUrl = reader.result as string
        
        setImageSrc(dataUrl)
        setRevealSteps([])
        setCurrentStep(0)
        setIsProcessingLines(true)

        const img = new window.Image()
        img.onload = async () => {
          setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight })
          
          try {
            const steps = await detectTextLinesForReveal(img)
            setRevealSteps(steps)
            console.log('Reveal steps created:', steps.length)
          } catch (error) {
            console.error("Line detection failed:", error)
            alert("Failed to detect text lines. Please try again.")
          }
          
          setIsProcessingLines(false)
        }
        img.onerror = (e) => {
          console.error("Error loading image:", e)
          alert("Error loading image. Please try a different image.")
          setIsProcessingLines(false)
        }
        img.src = dataUrl
      } catch (error) {
        console.error("Error processing file:", error)
        alert("Error processing file. Please try again.")
        setIsProcessingLines(false)
      }
    }
    
    reader.readAsDataURL(file)
  }, [detectTextLinesForReveal])

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      setCameraStream(stream)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
    } catch (err) {
      console.error("Error accessing camera:", err)
      alert("Could not access camera. Please ensure permissions are granted.")
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop())
      setCameraStream(null)
    }
  }, [cameraStream])

  const handleStartRecording = useCallback(() => {
    startCamera()
    setCurrentStep(1) // Start with first step revealed
  }, [startCamera])

  const handleNextStep = useCallback(() => {
    if (currentStep < revealSteps.length) {
      setCurrentStep((prev) => prev + 1)
    }
  }, [currentStep, revealSteps.length])

  const handleReset = useCallback(() => {
    setImageSrc(null)
    setRevealSteps([])
    setCurrentStep(0)
    stopCamera()
    setImageDimensions(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [stopCamera])

  // Calculate current reveal height
  const getCurrentRevealHeight = () => {
    if (!imageDimensions || revealSteps.length === 0) return 0
    if (currentStep === 0) return 0
    if (currentStep > revealSteps.length) return imageDimensions.height
    return revealSteps[currentStep - 1].revealHeight
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <h1 className="text-3xl font-bold text-center mb-6 text-gray-900">Math Shorts Creator</h1>

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {!imageSrc && (
        <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6 text-center">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Step 1: Upload Math Problem Image</h2>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
            id="image-upload"
            ref={fileInputRef}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-3 text-lg bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-md transition-colors duration-200"
          >
            <Upload className="mr-2 h-5 w-5" /> Upload Image
          </Button>
          <p className="text-sm text-gray-500 mt-3">Upload a clear image of your math problem to reveal step by step.</p>
        </div>
      )}

      {imageSrc && (
        <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg p-6 relative overflow-hidden">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Step 2: Reveal Math Problem Line by Line</h2>
          
          <div
            className="relative w-full max-w-full mx-auto border border-gray-300 rounded-md overflow-hidden"
            style={{
              paddingBottom: imageDimensions ? `${(imageDimensions.height / imageDimensions.width) * 100}%` : "56.25%",
              height: 0,
            }}
          >
            <Image
              src={imageSrc}
              alt="Math problem"
              width={imageDimensions?.width || 800}
              height={imageDimensions?.height || 600}
              className="absolute inset-0 w-full h-full object-contain"
              ref={imageRef}
              unoptimized={true}
            />
            
            {isProcessingLines && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-lg font-semibold z-20">
                Analyzing math problem...
              </div>
            )}
            
            {/* White overlay that covers the unrevealed part */}
            {imageDimensions && (
              <div className="absolute inset-0 z-10">
                <div
                  className="absolute bg-white transition-all duration-700 ease-in-out"
                  style={{
                    left: 0,
                    top: `${(getCurrentRevealHeight() / imageDimensions.height) * 100}%`,
                    width: '100%',
                    height: `${100 - (getCurrentRevealHeight() / imageDimensions.height) * 100}%`,
                  }}
                />
              </div>
            )}
          </div>

          {/* Camera overlay */}
          {cameraStream && (
            <div className="absolute top-4 right-4 w-24 h-24 sm:w-32 sm:h-32 bg-black rounded-full overflow-hidden border-2 border-white shadow-lg z-30">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scale-x-[-1]"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={stopCamera}
                className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Controls */}
          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-4">
            {!cameraStream && revealSteps.length > 0 && !isProcessingLines && (
              <Button
                onClick={handleStartRecording}
                className="w-full sm:w-auto py-3 text-lg bg-green-600 hover:bg-green-700 text-white rounded-md shadow-md transition-colors duration-200"
              >
                <Camera className="mr-2 h-5 w-5" /> Start Recording & Reveal
              </Button>
            )}
            
            {cameraStream && (
              <Button
                onClick={handleNextStep}
                disabled={currentStep >= revealSteps.length}
                className="w-full sm:w-auto py-3 text-lg bg-purple-600 hover:bg-purple-700 text-white rounded-md shadow-md transition-colors duration-200"
              >
                <ArrowRight className="mr-2 h-5 w-5" />
                {currentStep >= revealSteps.length ? "Fully Revealed" : `Reveal Next Line`}
              </Button>
            )}
            
            <Button
              onClick={handleReset}
              variant="outline"
              className="w-full sm:w-auto py-3 text-lg border-gray-300 text-gray-700 hover:bg-gray-100 rounded-md shadow-md transition-colors duration-200"
            >
              Reset
            </Button>
          </div>
          
          {/* Status display */}
          {!cameraStream && revealSteps.length > 0 && !isProcessingLines && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 text-center">
                <strong>Ready to record!</strong><br/>
                Found {revealSteps.length} steps to reveal. Click "Start Recording & Reveal" to begin.
              </p>
            </div>
          )}
          
          {cameraStream && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 text-center">
                <strong>Recording in progress!</strong><br/>
                Step {currentStep} of {revealSteps.length} revealed. Use screen recording on your device.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}