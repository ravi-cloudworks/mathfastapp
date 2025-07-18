"use client"

import type React from "react"

import { useState, useRef, useEffect, useCallback } from "react"
import { createWorker } from "tesseract.js"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Camera, Upload, ArrowRight, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type Tesseract from "tesseract.js" // Import Tesseract

interface OCRLine {
  text: string
  bbox: {
    x0: number
    y0: number
    x1: number
    y1: number
  }
}

export default function MathShortsCreator() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [ocrLines, setOcrLines] = useState<OCRLine[]>([])
  const [revealedLineCount, setRevealedLineCount] = useState(0)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [isProcessingOcr, setIsProcessingOcr] = useState(false)
  const [imageDimensions, setImageDimensions] = useState<{
    width: number
    height: number
  } | null>(null) // Stores natural (original) image dimensions
  const [renderedImageDimensions, setRenderedImageDimensions] = useState<{
    width: number
    height: number
  } | null>(null) // Stores actual rendered image dimensions
  const videoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize Tesseract worker once
  const workerRef = useRef<Tesseract.Worker | null>(null)
  useEffect(() => {
    const initializeWorker = async () => {
      workerRef.current = await createWorker("eng")
    }
    initializeWorker()
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate()
      }
    }
  }, [])

  const handleImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file')
      return
    }

    // Validate file size (limit to 10MB)
    if (file.size > 10 * 1024 * 1024) {
      alert('Image too large. Please upload an image smaller than 10MB')
      return
    }

    console.log("File selected:", file.name, file.type, file.size)

    const reader = new FileReader()
    reader.onloadend = async () => {
      try {
        const dataUrl = reader.result as string
        console.log("Data URL created, length:", dataUrl.length)
        
        setImageSrc(dataUrl)
        setOcrLines([])
        setRevealedLineCount(0)
        setIsProcessingOcr(true)

        // Create image to get dimensions
        const img = new window.Image()
        img.onload = () => {
          console.log("Image dimensions:", img.naturalWidth, "x", img.naturalHeight)
          setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight })
        }
        img.onerror = (e) => {
          console.error("Error loading image for dimensions:", e)
          alert("Error loading image. Please try a different image.")
          setIsProcessingOcr(false)
        }
        img.src = dataUrl

        // OCR Processing
        if (workerRef.current) {
          try {
            console.log("Starting OCR processing...")
            const { data } = await workerRef.current.recognize(dataUrl)
            console.log("OCR completed, data:", data)
            
            // Simple approach: get text lines and try to find their real Y positions
            if (data.text) {
              const lines = data.text.split('\n').filter(line => line.trim())
              console.log("Extracted lines:", lines)
              
              // Debug: Let's see what's actually available in the data
              console.log("Available data keys:", Object.keys(data))
              console.log("Blocks available:", !!(data as any).blocks)
              console.log("Words available:", !!(data as any).words)
              console.log("Symbols available:", !!(data as any).symbols)
              
              // Try to get real Y positions from word-level data
              let processedLines: OCRLine[] = []
              
              // First, try blocks -> paragraphs -> lines -> words structure
              if ((data as any).blocks && Array.isArray((data as any).blocks)) {
                console.log("Trying blocks structure...")
                const blocks = (data as any).blocks as any[]
                
                blocks.forEach((block: any) => {
                  if (block.paragraphs && Array.isArray(block.paragraphs)) {
                    block.paragraphs.forEach((paragraph: any) => {
                      if (paragraph.lines && Array.isArray(paragraph.lines)) {
                        paragraph.lines.forEach((line: any) => {
                          if (line.text && line.text.trim() && line.bbox) {
                            processedLines.push({
                              text: line.text.trim(),
                              bbox: {
                                x0: line.bbox.x0,
                                y0: line.bbox.y0,
                                x1: line.bbox.x1,
                                y1: line.bbox.y1
                              }
                            })
                            console.log(`Found line from blocks: "${line.text}" - Y: ${line.bbox.y0} to ${line.bbox.y1}`)
                          }
                        })
                      }
                    })
                  }
                })
              }
              
              // If no lines from blocks, try words approach
              if (processedLines.length === 0 && (data as any).words && Array.isArray((data as any).words)) {
                console.log("Trying words structure...")
                const words = (data as any).words as any[]
                console.log("Found words:", words.length)
                
                // Group words by approximate Y position to form lines
                const lineGroups = new Map<number, any[]>()
                
                words.forEach((word: any) => {
                  if (word.text && word.text.trim() && word.bbox) {
                    const yPos = Math.round(word.bbox.y0 / 20) * 20 // Group by 20px intervals
                    if (!lineGroups.has(yPos)) {
                      lineGroups.set(yPos, [])
                    }
                    lineGroups.get(yPos)!.push(word)
                  }
                })
                
                console.log("Word groups by Y position:", Array.from(lineGroups.keys()).sort((a, b) => a - b))
                
                // Convert word groups to lines
                const sortedGroups = Array.from(lineGroups.entries()).sort(([a], [b]) => a - b)
                
                sortedGroups.forEach(([yPos, words], index) => {
                  words.sort((a, b) => a.bbox.x0 - b.bbox.x0) // Sort by x position
                  const lineText = words.map(w => w.text).join(' ').trim()
                  const minY = Math.min(...words.map(w => w.bbox.y0))
                  const maxY = Math.max(...words.map(w => w.bbox.y1))
                  
                  if (lineText && lines.includes(lineText)) {
                    processedLines.push({
                      text: lineText,
                      bbox: {
                        x0: 0,
                        y0: minY,
                        x1: img.naturalWidth,
                        y1: maxY
                      }
                    })
                    console.log(`Created line from words: "${lineText}" - Y: ${minY} to ${maxY}`)
                  }
                })
              }
              
              // If still no lines, use improved fallback
              if (processedLines.length === 0) {
                console.log("Using improved fallback positioning...")
                
                // Better fallback based on your actual image layout
                // Your image: 1200x630, text starts around 15% from top
                const imageHeight = img.naturalHeight
                const imageWidth = img.naturalWidth
                
                // Analyze your specific layout
                const positions = [
                  { startPercent: 0.15, heightPercent: 0.12 }, // Line 1: "Only one in 1000..."
                  { startPercent: 0.30, heightPercent: 0.10 }, // Line 2: "1+4=5"
                  { startPercent: 0.45, heightPercent: 0.10 }, // Line 3: "2+5=12"
                  { startPercent: 0.60, heightPercent: 0.10 }, // Line 4: "3+6=21"
                  { startPercent: 0.75, heightPercent: 0.10 }, // Line 5: "8+11=7?"
                ]
                
                processedLines = lines.map((text, index) => {
                  const pos = positions[index] || { startPercent: 0.15 + (index * 0.15), heightPercent: 0.10 }
                  return {
                    text: text.trim(),
                    bbox: {
                      x0: 0,
                      y0: imageHeight * pos.startPercent,
                      x1: imageWidth,
                      y1: imageHeight * (pos.startPercent + pos.heightPercent)
                    }
                  }
                })
              }
              
              console.log("Final processed lines with Y positions:")
              processedLines.forEach((line, index) => {
                console.log(`Line ${index}: "${line.text}" - Y range: ${line.bbox.y0} to ${line.bbox.y1}`)
              })
              
              setOcrLines(processedLines)
            } else {
              console.warn("No text found in OCR result")
              setOcrLines([])
            }
          } catch (error) {
            console.error("OCR processing failed:", error)
            alert("Failed to process image with OCR. Please try again.")
          }
        }
        
        setIsProcessingOcr(false)
      } catch (error) {
        console.error("Error processing file:", error)
        alert("Error processing file. Please try again.")
        setIsProcessingOcr(false)
      }
    }
    
    reader.onerror = (e) => {
      console.error("FileReader error:", e)
      alert("Error reading file. Please try again.")
    }
    
    reader.readAsDataURL(file)
  }, [])

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      setCameraStream(stream)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        console.log("Camera stream started.")
      }
    } catch (err) {
      console.error("Error accessing camera:", err)
      alert("Could not access camera. Please ensure permissions are granted and no other app is using it.")
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop())
      setCameraStream(null)
      console.log("Camera stream stopped.")
    }
  }, [cameraStream])

  const handleRecordVideoNow = useCallback(() => {
    startCamera()
    setRevealedLineCount(1) // Reveal the first line
  }, [startCamera])

  const handleNextStep = useCallback(() => {
    if (revealedLineCount < ocrLines.length) {
      setRevealedLineCount((prev) => prev + 1)
    }
  }, [revealedLineCount, ocrLines.length])

  const handleReset = useCallback(() => {
    setImageSrc(null)
    setOcrLines([])
    setRevealedLineCount(0)
    stopCamera()
    setImageDimensions(null)
    setRenderedImageDimensions(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = "" // Clear file input
    }
  }, [stopCamera])

  // Update rendered image dimensions on resize
  useEffect(() => {
    const handleResize = () => {
      if (imageRef.current) {
        setRenderedImageDimensions({
          width: imageRef.current.offsetWidth,
          height: imageRef.current.offsetHeight,
        })
      }
    }
    window.addEventListener("resize", handleResize)
    // Initial set if image is already loaded
    if (imageRef.current) {
      setRenderedImageDimensions({
        width: imageRef.current.offsetWidth,
        height: imageRef.current.offsetHeight,
      })
    }
    return () => window.removeEventListener("resize", handleResize)
  }, [imageSrc]) // Re-run when imageSrc changes to re-evaluate dimensions

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <h1 className="text-3xl font-bold text-center mb-6 text-gray-900">Math Shorts Creator</h1>

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
          <p className="text-sm text-gray-500 mt-3">Upload a clear image of your solved math problem, line by line.</p>
        </div>
      )}

      {imageSrc && (
        <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg p-6 relative overflow-hidden">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Step 2: Explain Line by Line</h2>
          <div
            className="relative w-full max-w-full mx-auto border border-gray-300 rounded-md overflow-hidden"
            style={{
              // Set explicit dimensions for the container based on natural aspect ratio
              // This helps ensure the overlays align correctly even before image fully renders
              paddingBottom: imageDimensions ? `${(imageDimensions.height / imageDimensions.width) * 100}%` : "56.25%", // Default to 16:9 if no dimensions yet
              height: 0,
            }}
          >
            <Image
              src={imageSrc}
              alt="Uploaded math problem"
              width={imageDimensions?.width || 800}
              height={imageDimensions?.height || 600}
              className="absolute inset-0 w-full h-full object-contain"
              ref={imageRef}
              onLoad={(e) => {
                const img = e.target as HTMLImageElement
                console.log("Image loaded successfully")
                console.log("Natural dimensions:", img.naturalWidth, "x", img.naturalHeight)
                setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight })
                setRenderedImageDimensions({ width: img.offsetWidth, height: img.offsetHeight })
              }}
              onError={(e) => {
                console.error("Image failed to load:", e)
                console.error("Image src:", imageSrc?.substring(0, 100) + "...")
              }}
              unoptimized={true}
            />
            {isProcessingOcr && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-lg font-semibold z-20">
                Processing image...
              </div>
            )}
            {/* Simple overlay that covers everything below the revealed lines */}
            {ocrLines.length > 0 && imageDimensions && (
              <div className="absolute inset-0 z-10">
                {revealedLineCount < ocrLines.length && (
                  <div
                    className="absolute bg-white transition-all duration-500 ease-in-out"
                    style={{
                      left: 0,
                      top: `${((ocrLines[revealedLineCount]?.bbox.y0 || 0) / imageDimensions.height) * 100}%`,
                      width: '100%',
                      height: `${100 - ((ocrLines[revealedLineCount]?.bbox.y0 || 0) / imageDimensions.height) * 100}%`,
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {cameraStream && (
            <div className="absolute top-4 right-4 w-24 h-24 sm:w-32 sm:h-32 bg-black rounded-full overflow-hidden border-2 border-white shadow-lg z-30">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scale-x-[-1]" // Mirror effect for selfie cam
                aria-label="Teacher's camera feed"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={stopCamera}
                className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/50 text-white hover:bg-black/70"
                aria-label="Stop camera"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-4">
            {!cameraStream && ocrLines.length > 0 && !isProcessingOcr && (
              <Button
                onClick={handleRecordVideoNow}
                className="w-full sm:w-auto py-3 text-lg bg-green-600 hover:bg-green-700 text-white rounded-md shadow-md transition-colors duration-200"
              >
                <Camera className="mr-2 h-5 w-5" /> Start Recording & Reveal
              </Button>
            )}
            {cameraStream && (
              <Button
                onClick={handleNextStep}
                disabled={revealedLineCount === ocrLines.length}
                className="w-full sm:w-auto py-3 text-lg bg-purple-600 hover:bg-purple-700 text-white rounded-md shadow-md transition-colors duration-200"
              >
                <ArrowRight className="mr-2 h-5 w-5" />{" "}
                {revealedLineCount === ocrLines.length ? "All Lines Revealed" : `Reveal Line ${revealedLineCount + 1}`}
              </Button>
            )}
            {imageSrc && (
              <Button
                onClick={handleReset}
                variant="outline"
                className="w-full sm:w-auto py-3 text-lg border-gray-300 text-gray-700 hover:bg-gray-100 rounded-md shadow-md transition-colors duration-200 bg-transparent"
              >
                Reset
              </Button>
            )}
          </div>
          
          {!cameraStream && ocrLines.length > 0 && !isProcessingOcr && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 text-center">
                <strong>Ready to create your video!</strong><br/>
                Click "Start Recording & Reveal" to begin the step-by-step revelation.
                {ocrLines.length > 0 && (
                  <span className="block mt-1">
                    Found {ocrLines.length} lines to reveal: {ocrLines.map(line => `"${line.text}"`).join(', ')}
                  </span>
                )}
              </p>
            </div>
          )}
          {cameraStream && (
            <p className="text-sm text-gray-500 mt-4 text-center">
              Now, use your phone's screen recording feature to capture this!
            </p>
          )}
        </div>
      )}
    </div>
  )
}