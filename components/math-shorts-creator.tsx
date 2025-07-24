"use client"
import React, { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Camera, Upload, ArrowLeft, ArrowRight, X, Mic, Smartphone, Monitor, Square } from "lucide-react"

interface RevealStep {
  revealHeight: number
  description: string
}

export default function TeacherShortsApp() {
  const [imageList, setImageList] = useState<string[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [revealSteps, setRevealSteps] = useState<RevealStep[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [isProcessingLines, setIsProcessingLines] = useState(false)
  const [showScreenRecordingInstructions, setShowScreenRecordingInstructions] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [isAppInitialized, setIsAppInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [imageDimensions, setImageDimensions] = useState<{
    width: number
    height: number
    isPortrait: boolean
    aspectRatio: number
  } | null>(null)

  // ADD THESE NEW STATE VARIABLES:
  const [viewportHeight, setViewportHeight] = useState(0)
  const [safeAreas, setSafeAreas] = useState({ top: 0, bottom: 0 })

  const videoRef = useRef<HTMLVideoElement>(null)
  const visibleVideoRef = useRef<HTMLVideoElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Get current image source
  const getCurrentImageSrc = () => {
    return imageList[currentImageIndex] || null
  }

  // Detect text lines to create reveal steps
  const detectTextLinesForReveal = useCallback(async (imageElement: HTMLImageElement) => {
    return new Promise<RevealStep[]>((resolve) => {
      console.log('🔍 Starting text line detection...')
      const canvas = canvasRef.current
      if (!canvas) {
        console.error('🔍 Canvas not found')
        resolve([])
        return
      }

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        console.error('🔍 Canvas context not found')
        resolve([])
        return
      }

      canvas.width = imageElement.naturalWidth
      canvas.height = imageElement.naturalHeight
      ctx.drawImage(imageElement, 0, 0)
      console.log(`🔍 Canvas setup: ${canvas.width}x${canvas.height}`)

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data

      const grayData = new Uint8Array(canvas.width * canvas.height)
      for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
        grayData[i / 4] = gray < 128 ? 0 : 255
      }

      const horizontalProjection = new Array(canvas.height).fill(0)
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const idx = y * canvas.width + x
          if (grayData[idx] === 0) {
            horizontalProjection[y]++
          }
        }
      }

      const textLines: { start: number; end: number }[] = []
      let inTextLine = false
      let lineStart = 0
      const minTextDensity = Math.max(3, canvas.width * 0.01)
      console.log(`🔍 Min text density threshold: ${minTextDensity}`)

      for (let y = 0; y < horizontalProjection.length; y++) {
        const hasText = horizontalProjection[y] > minTextDensity

        if (hasText && !inTextLine) {
          inTextLine = true
          lineStart = y
        } else if (!hasText && inTextLine) {
          inTextLine = false
          textLines.push({ start: lineStart, end: y })
        }
      }

      if (inTextLine) {
        textLines.push({ start: lineStart, end: canvas.height })
      }

      console.log(`🔍 Raw text lines detected: ${textLines.length}`)

      const filteredLines: { start: number; end: number }[] = []
      for (let i = 0; i < textLines.length; i++) {
        const line = textLines[i]
        if (line.end - line.start < 8) continue

        const nextLine = textLines[i + 1]
        if (nextLine && (nextLine.start - line.end) < 15) {
          filteredLines.push({ start: line.start, end: nextLine.end })
          i++
        } else {
          filteredLines.push(line)
        }
      }

      const steps: RevealStep[] = filteredLines.map((line, index) => ({
        revealHeight: line.end + 10,
        description: `Step ${index + 1}`
      }))

      console.log(`🔍 Final reveal steps created: ${steps.length}`)
      console.log('🔍 Reveal steps:', steps)
      resolve(steps)
    })
  }, [])

  // Resize image to 9:16 ratio for consistent processing
  const resizeImageTo9x16 = useCallback((originalImage: HTMLImageElement): Promise<string> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')!

      // Calculate target dimensions (9:16 ratio)
      const targetWidth = 720 // Standard width for good quality
      const targetHeight = 1280 // 720 * (16/9) = 1280

      canvas.width = targetWidth
      canvas.height = targetHeight

      // Fill with white background
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, targetWidth, targetHeight)

      // Calculate how to fit the image in 9:16 container
      const imageAspect = originalImage.width / originalImage.height
      const targetAspect = targetWidth / targetHeight

      let drawWidth, drawHeight, drawX, drawY

      if (imageAspect > targetAspect) {
        // Image is wider - fit by width
        drawWidth = targetWidth
        drawHeight = targetWidth / imageAspect
        drawX = 0
        drawY = (targetHeight - drawHeight) / 2
      } else {
        // Image is taller - fit by height  
        drawHeight = targetHeight
        drawWidth = targetHeight * imageAspect
        drawX = (targetWidth - drawWidth) / 2
        drawY = 0
      }

      // Draw the image centered in the canvas
      ctx.drawImage(originalImage, drawX, drawY, drawWidth, drawHeight)

      console.log(`🎨 Resized image: ${originalImage.width}x${originalImage.height} → ${targetWidth}x${targetHeight}`)
      console.log(`🎨 Draw position: ${drawX.toFixed(1)}, ${drawY.toFixed(1)}, ${drawWidth.toFixed(1)}x${drawHeight.toFixed(1)}`)

      // Convert to data URL
      resolve(canvas.toDataURL('image/jpeg', 0.95))
    })
  }, [])

  const processImage = useCallback(async (dataUrl: string) => {
    return new Promise<void>((resolve, reject) => {
      const img = new window.Image()
      img.onload = async () => {
        try {
          const originalWidth = img.naturalWidth
          const originalHeight = img.naturalHeight
          const originalAspectRatio = originalWidth / originalHeight
          const isPortrait = originalHeight > originalWidth

          console.log(`📱 Original image: ${originalWidth}x${originalHeight}, aspect ratio: ${originalAspectRatio.toFixed(2)}, portrait: ${isPortrait}`)

          // Resize image to 9:16 ratio
          const resizedDataUrl = await resizeImageTo9x16(img)

          // Load the resized image for text detection
          const resizedImg = new window.Image()
          resizedImg.onload = async () => {
            const width = resizedImg.naturalWidth
            const height = resizedImg.naturalHeight
            const aspectRatio = width / height

            console.log(`📱 Resized image: ${width}x${height}, aspect ratio: ${aspectRatio.toFixed(2)}`)

            setImageDimensions({
              width,
              height,
              isPortrait: height > width,
              aspectRatio
            })

            // Update the image list with resized version
            setImageList(prev => {
              const newList = [...prev]
              newList[currentImageIndex] = resizedDataUrl
              return newList
            })

            // Run text detection on resized image
            const steps = await detectTextLinesForReveal(resizedImg)
            setRevealSteps(steps)

            // Check if no steps were detected
            if (steps.length === 0) {
              console.warn('⚠️ No text lines detected in resized image')
              // Create fallback steps based on resized image height
              const fallbackSteps = [
                { revealHeight: Math.floor(height * 0.33), description: 'Step 1' },
                { revealHeight: Math.floor(height * 0.66), description: 'Step 2' },
                { revealHeight: height, description: 'Step 3' }
              ]
              setRevealSteps(fallbackSteps)
              console.log('🔧 Created fallback reveal steps:', fallbackSteps.length)
            }

            setError(null) // Clear any previous errors
            resolve()
          }

          resizedImg.onerror = (e) => {
            console.error('❌ Error loading resized image:', e)
            reject(new Error('Failed to process resized image.'))
          }

          resizedImg.src = resizedDataUrl

        } catch (error) {
          console.error('❌ Error in image processing:', error)
          reject(error)
        }
      }
      img.onerror = (e) => {
        console.error('❌ Error loading original image:', e)
        reject(new Error('Failed to load image. Please try a different image.'))
      }
      img.src = dataUrl
    })
  }, [detectTextLinesForReveal, resizeImageTo9x16, currentImageIndex])

  const handleImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return

    const validFiles = Array.from(files).filter(file => {
      if (!file.type.startsWith('image/')) {
        setError(`"${file.name}" is not a valid image file. Please upload JPG, PNG, or other image formats.`)
        return false
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`"${file.name}" is too large (${Math.round(file.size / 1024 / 1024)}MB). Please upload images smaller than 10MB.`)
        return false
      }
      return true
    })

    if (validFiles.length === 0) return

    setIsProcessingLines(true)
    setError(null) // Clear previous errors
    const imageUrls: string[] = []

    try {
      for (const file of validFiles) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`))
          reader.readAsDataURL(file)
        })
        imageUrls.push(dataUrl)
      }

      setImageList(imageUrls)
      setCurrentImageIndex(0)
      setCurrentStep(0)
      setRetryCount(0) // Reset retry count
      await processImage(imageUrls[0])

      // After processing, show instructions immediately
      setShowScreenRecordingInstructions(true)

    } catch (error) {
      console.error("❌ Error processing files:", error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      setError(`Processing failed: ${errorMessage}. Please try again or use a different image.`)
    }

    setIsProcessingLines(false)
  }, [processImage])

  // REPLACE the complex startCamera, chooseAudioOnly, chooseCameraMode functions
  // WITH this simple camera toggle:

  const toggleCamera = useCallback(async () => {
    if (showCamera && cameraStream) {
      // Turn off camera
      cameraStream.getTracks().forEach((track) => track.stop())
      setCameraStream(null)
      setShowCamera(false)
      setCameraError(null)
      console.log('📷 Camera turned off')
    } else {
      // Turn on camera
      try {
        console.log('📷 Starting camera...')
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          },
          audio: false // We don't need audio for face cam
        })

        setCameraStream(stream)
        setShowCamera(true)
        setCameraError(null)
        console.log('📷 Camera started successfully')

        // Attach to video element
        setTimeout(() => {
          if (visibleVideoRef.current) {
            visibleVideoRef.current.srcObject = stream
            visibleVideoRef.current.play().catch(console.error)
          }
        }, 100)

      } catch (error) {
        console.error('📷 Camera failed:', error)
        setCameraError('Camera access denied. Please allow camera permission.')
        setShowCamera(false)
      }
    }
  }, [showCamera, cameraStream])
  // Initialize app on mount
  useEffect(() => {
    const initializeApp = async () => {
      console.log('🚀 Initializing Math Fast APP Creator...')

      // Simulate initialization tasks that happen in the background
      await new Promise(resolve => setTimeout(resolve, 1500)) // 1.5 second delay

      // Test canvas functionality
      try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          throw new Error('Canvas not supported')
        }
        console.log('✅ Canvas initialized')
      } catch (error) {
        console.error('❌ Canvas initialization failed:', error)
      }

      // Test file reading capability
      try {
        if (!window.FileReader) {
          throw new Error('FileReader not supported')
        }
        console.log('✅ File reading initialized')
      } catch (error) {
        console.error('❌ File reading initialization failed:', error)
      }

      console.log('🎉 App initialization complete!')
      setIsAppInitialized(true)
    }

    initializeApp()
  }, [])

  useEffect(() => {
    // When camera becomes ready, attach stream to visible video element
    if (showCamera && cameraStream && visibleVideoRef.current) {
      console.log('🎥 Attaching stream to visible video element')
      visibleVideoRef.current.srcObject = cameraStream
      visibleVideoRef.current.play().catch(console.error)
    }
  }, [showCamera, cameraStream])

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop())
      setCameraStream(null)
    }

  }, [cameraStream])

  const handleStartRecording = useCallback(() => {
    // This function is no longer needed since we go directly to instructions
    // after upload, but keeping it for any edge cases
    setShowScreenRecordingInstructions(true)
  }, [])

  const handleReadyToRecord = useCallback(() => {
    setShowScreenRecordingInstructions(false)

  }, [])

  const handleNextStep = useCallback(async () => {
    if (currentStep < revealSteps.length) {
      setCurrentStep((prev) => prev + 1)
    } else if (currentImageIndex < imageList.length - 1) {
      const nextIndex = currentImageIndex + 1
      setCurrentImageIndex(nextIndex)
      setCurrentStep(0)
      setIsProcessingLines(true)

      try {
        await processImage(imageList[nextIndex])
        setCurrentStep(1)
      } catch (error) {
        console.error("Error processing next image:", error)
        alert("Error processing next image. Please try again.")
      }

      setIsProcessingLines(false)
    }
  }, [currentStep, revealSteps.length, currentImageIndex, imageList, processImage])

  const handlePrevStep = useCallback(async () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1)
    } else if (currentImageIndex > 0) {
      const prevIndex = currentImageIndex - 1
      setCurrentImageIndex(prevIndex)
      setIsProcessingLines(true)

      try {
        await processImage(imageList[prevIndex])
        const loadImage = (src: string): Promise<HTMLImageElement> => {
          return new Promise((resolve, reject) => {
            const img = new window.Image()
            img.onload = () => resolve(img)
            img.onerror = reject
            img.src = src
          })
        }
        const steps = await detectTextLinesForReveal(await loadImage(imageList[prevIndex]))
        setCurrentStep(steps.length)
      } catch (error) {
        console.error("Error processing previous image:", error)
        alert("Error processing previous image. Please try again.")
      }

      setIsProcessingLines(false)
    }
  }, [currentStep, currentImageIndex, imageList, processImage, detectTextLinesForReveal])

  const handleReset = useCallback(() => {
    setImageList([])
    setCurrentImageIndex(0)
    setRevealSteps([])
    setCurrentStep(0)
    setShowScreenRecordingInstructions(false)

    setShowCamera(false)
    setCameraError(null)
    setError(null) // Clear errors
    setRetryCount(0) // Reset retry count
    stopCamera()
    setImageDimensions(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [stopCamera])

  const handleRetry = useCallback(() => {
    setRetryCount(prev => prev + 1)
    setError(null)

    if (imageList.length > 0) {
      // Retry processing current image
      setIsProcessingLines(true)
      processImage(imageList[currentImageIndex])
        .then(() => {
          setIsProcessingLines(false)
          if (currentStep === 0) {
            setShowScreenRecordingInstructions(true)
          }
        })
        .catch((error) => {
          setIsProcessingLines(false)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
          setError(`Retry failed: ${errorMessage}. Please try a different image.`)
        })
    }
  }, [imageList, currentImageIndex, processImage, currentStep])

  const getCurrentRevealHeight = () => {
    if (!imageDimensions || revealSteps.length === 0) return 0
    if (currentStep === 0) return 0
    if (currentStep > revealSteps.length) return imageDimensions.height

    // Simple reveal - no conversion needed since image is already 9:16
    const revealHeight = revealSteps[currentStep - 1].revealHeight

    console.log(`🎯 Reveal step ${currentStep}: Height=${revealHeight}px`)

    return revealHeight
  }

  const currentImageSrc = getCurrentImageSrc()

  // Add viewport meta tag for mobile
  useEffect(() => {
    // Simple, mobile-friendly viewport
    const viewport = document.querySelector('meta[name=viewport]');
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, user-scalable=no');
    } else {
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, user-scalable=no';
      document.getElementsByTagName('head')[0].appendChild(meta);
    }

    // Prevent any body scrolling
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    const updateViewport = () => {
      const vh = window.innerHeight
      setViewportHeight(vh)

      // Detect safe areas
      const testEl = document.createElement('div')
      testEl.style.position = 'fixed'
      testEl.style.top = 'env(safe-area-inset-top)'
      testEl.style.bottom = 'env(safe-area-inset-bottom)'
      testEl.style.visibility = 'hidden'
      document.body.appendChild(testEl)

      const computedStyle = getComputedStyle(testEl)
      const topSafe = parseInt(computedStyle.top) || 0
      const bottomSafe = parseInt(computedStyle.bottom) || 0

      setSafeAreas({ top: topSafe, bottom: bottomSafe })
      document.body.removeChild(testEl)

      console.log('📱 Viewport updated:', { vh, topSafe, bottomSafe })
    }

    updateViewport()
    window.addEventListener('resize', updateViewport)
    window.addEventListener('orientationchange', updateViewport)

    return () => {
      window.removeEventListener('resize', updateViewport)
      window.removeEventListener('orientationchange', updateViewport)
    }
  }, [])

  // ADD THIS CSS SAFE AREA SUPPORT useEffect:
  useEffect(() => {
    // Add CSS custom properties for safe areas
    const style = document.createElement('style')
    style.textContent = `
      :root {
        --safe-area-inset-top: env(safe-area-inset-top, 0px);
        --safe-area-inset-bottom: env(safe-area-inset-bottom, 0px);
      }
      * {
        -webkit-overflow-scrolling: touch;
      }
    `
    document.head.appendChild(style)

    return () => {
      if (document.head.contains(style)) {
        document.head.removeChild(style)
      }
    }
  }, [])

  // useEffect(() => {
  //   if (currentImageSrc) {
  //     console.log('📱 Mobile Debug:', {
  //       currentImageSrc: !!currentImageSrc,
  //       currentStep,
  //       revealSteps: revealSteps.length,
  //       cameraState,
  //       imageDimensions,
  //       windowSize: { width: window.innerWidth, height: window.innerHeight },
  //       userAgent: navigator.userAgent
  //     });
  //   }
  // }, [currentImageSrc, currentStep, revealSteps.length, cameraState, imageDimensions]);

  // App initialization loader
  if (!isAppInitialized) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 overflow-hidden">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <div className="mb-6">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Camera className="h-8 w-8 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 mb-2">Math Fast APP</h1>
              <p className="text-slate-600">Preparing AI for content creation</p>
            </div>

            <div className="space-y-4 mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm text-slate-700">Loading image processing...</span>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" style={{ animationDelay: '0.3s' }}></div>
                <span className="text-sm text-slate-700">Initializing text detection...</span>
              </div>
              <div className="flex items-center space-x-3">
                <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" style={{ animationDelay: '0.6s' }}></div>
                <span className="text-sm text-slate-700">Setting up camera support...</span>
              </div>
            </div>

            <div className="w-full bg-slate-200 rounded-full h-2 mb-4">
              <div className="bg-gradient-to-r from-purple-600 to-blue-600 h-2 rounded-full animate-pulse" style={{ width: '75%' }}></div>
            </div>

            <p className="text-xs text-slate-500">
              Please wait while we prepare everything for the best experience
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }


  if (showScreenRecordingInstructions) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <h2 className="text-xl font-bold text-center mb-6 text-slate-900">Ready to Create Explainer Video!</h2>

            <div className="space-y-4 mb-6">
              <div className="flex items-center space-x-3 p-3 bg-blue-50 rounded-lg">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">1</div>
                <div>
                  <p className="font-medium text-blue-900">Start Android Screen Recording</p>
                  <p className="text-sm text-blue-700">Swipe down → Screen Record (or use Control Panel)</p>
                </div>
              </div>

              <div className="flex items-center space-x-3 p-3 bg-green-50 rounded-lg">
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">2</div>
                <div>
                  <p className="font-medium text-green-900">Return to This App</p>
                  <p className="text-sm text-green-700">Switch back when recording starts</p>
                </div>
              </div>

              <div className="flex items-center space-x-3 p-3 bg-purple-50 rounded-lg">
                <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold">3</div>
                <div>
                  <p className="font-medium text-purple-900">Start Explaining</p>
                  <p className="text-sm text-slate-600">Use arrows to reveal steps while talking</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                onClick={() => setShowScreenRecordingInstructions(false)}
                className="w-full py-3 text-lg bg-purple-600 hover:bg-purple-700 text-white"
              >
                I'm Ready - Let's Go!
              </Button>

              <Button
                onClick={() => setShowScreenRecordingInstructions(false)}
                variant="outline"
                className="w-full py-2"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Main App UI
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Subtle branding in top corner - REMOVED to avoid duplicate */}

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Upload Phase (Step 1) */}
      {imageList.length === 0 && (
        <div className="flex flex-col items-center justify-center h-screen p-4 overflow-hidden">
          <Card className="w-full max-w-md">
            <CardContent className="p-6 text-center">
              <div className="mb-6">
                <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload className="h-8 w-8 text-white" />
                </div>
                <h2 className="text-xl font-semibold mb-2 text-slate-800">Math Fast APP</h2>
                <p className="text-sm text-slate-600">
                  For best YouTube Shorts results, use portrait images (9:16 ratio)
                </p>
              </div>

              {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800 mb-3">{error}</p>
                  <div className="flex gap-2 justify-center">
                    {retryCount < 3 && (
                      <Button
                        onClick={handleRetry}
                        variant="outline"
                        size="sm"
                        className="border-red-300 text-red-700 hover:bg-red-50"
                      >
                        Try Again ({3 - retryCount} left)
                      </Button>
                    )}
                    <Button
                      onClick={() => setError(null)}
                      variant="outline"
                      size="sm"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              )}

              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                id="image-upload"
                ref={fileInputRef}
                multiple
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessingLines}
                className="w-full py-3 text-lg bg-purple-600 hover:bg-purple-700 text-white"
              >
                {isProcessingLines ? (
                  <>
                    <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-5 w-5" />
                    Upload Images
                  </>
                )}
              </Button>

              {/* Aspect ratio guidance */}
              <div className="mt-4 flex justify-center space-x-4 text-xs text-slate-500">
                <div className="flex items-center space-x-1">
                  <Smartphone className="h-4 w-4 text-green-600" />
                  <span>Portrait: Best</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Square className="h-4 w-4 text-yellow-600" />
                  <span>Square: Good</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Monitor className="h-4 w-4 text-red-600" />
                  <span>Landscape: Poor</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Recording Phase (Step 2) - Compact mobile layout NO SCROLL */}
      {/* Recording Phase (Step 2) - Balanced mobile layout */}
      {currentImageSrc && (
        <div
          className="flex flex-col overflow-hidden bg-slate-50"
          style={{
            height: viewportHeight || '100vh',
            paddingTop: `${safeAreas.top}px`,
            paddingBottom: `${safeAreas.bottom}px`
          }}
        >
          {/* Header - visible but compact */}
          <div
            className="flex-shrink-0 py-2 px-4 text-center bg-white shadow-sm relative"
            style={{ height: `${Math.max(48, 12 + safeAreas.top)}px` }}
          >
            <h1 className="text-lg font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              Math Fast APP
            </h1>
            <Button
              onClick={handleReset}
              variant="ghost"
              size="icon"
              className="absolute top-1 right-2 h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 z-50"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Main content - optimized space for image */}
          <div
            className="flex items-center justify-center px-3 py-1"
            style={{
              height: `${viewportHeight - (Math.max(48, 12 + safeAreas.top)) - (Math.max(72, 20 + safeAreas.bottom))}px`
            }}
          >
            <div className="relative w-full max-w-sm mx-auto h-full">
              <div
                className="relative w-full bg-white rounded-xl overflow-hidden shadow-lg h-full"
                style={{
                  maxHeight: '100%',
                  minHeight: `${Math.min(400, (viewportHeight || 800) * 0.5)}px`
                }}
              >
                <img
                  src={currentImageSrc}
                  alt="Math problem"
                  className="absolute inset-0 w-full h-full object-contain bg-white"
                  ref={imageRef}
                  style={{
                    transform: 'translateZ(0)',
                    backfaceVisibility: 'hidden'
                  }}
                />

                {/* Processing overlay */}
                {isProcessingLines && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white z-20">
                    <div className="text-center">
                      <div className="animate-spin h-6 w-6 border-2 border-white border-t-transparent rounded-full mx-auto mb-2"></div>
                      <p className="text-sm">Analyzing...</p>
                    </div>
                  </div>
                )}

                {/* Error overlay */}
                {error && !isProcessingLines && (
                  <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 text-white z-20">
                    <div className="text-center p-4">
                      <p className="font-semibold mb-3 text-sm">Processing Failed</p>
                      <div className="flex gap-2 justify-center">
                        {retryCount < 3 && (
                          <Button
                            onClick={handleRetry}
                            size="sm"
                            className="bg-white text-red-900 hover:bg-gray-100 text-xs"
                          >
                            Retry
                          </Button>
                        )}
                        <Button
                          onClick={handleReset}
                          variant="outline"
                          size="sm"
                          className="border-white text-white hover:bg-white hover:text-red-900 text-xs"
                        >
                          Start Over
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Reveal overlay */}
                {imageDimensions && (
                  <div className="absolute inset-0 z-10 pointer-events-none">
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
            </div>
          </div>

          {/* Camera overlay - positioned to be fully visible */}
          {/* Camera toggle - positioned to be fully visible */}
          {showCamera && cameraStream && (
            <div className="absolute top-14 right-4 w-16 h-16 bg-black rounded-full overflow-hidden border-2 border-white shadow-lg z-30">
              <video
                ref={visibleVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scale-x-[-1]"
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleCamera}
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white hover:bg-red-600 p-0"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Camera error indicator */}
          {cameraError && (
            <div className="absolute top-14 right-4 w-12 h-12 bg-red-600 rounded-full flex items-center justify-center border-2 border-white shadow-lg z-30">
              <X className="h-4 w-4 text-white" />
            </div>
          )}

          {/* Bottom controls - adequate space */}
          <div
            className="flex-shrink-0 bg-white border-t border-slate-200 py-2"
            style={{ height: `${Math.max(72, 20 + safeAreas.bottom)}px` }}
          >
            <div className="flex items-center justify-center h-full px-4">
              {/* Initial start button */}
              {currentStep === 0 && revealSteps.length > 0 && !isProcessingLines && showScreenRecordingInstructions && (
                <div className="flex items-center space-x-3">
                  <Button
                    onClick={toggleCamera}
                    variant="outline"
                    className={`px-4 py-2 ${showCamera ? 'bg-green-50 border-green-300 text-green-800' : 'bg-slate-50 border-slate-300'}`}
                  >
                    <Camera className="mr-2 h-4 w-4" />
                    {showCamera ? 'Hide Face' : 'Show Face'}
                  </Button>

                  {/* <Button
                    onClick={handleStartRecording}
                    className="bg-purple-600 hover:bg-purple-700 text-white shadow-lg px-4 py-2"
                  >
                    Start Recording
                  </Button> */}
                </div>
              )}

              {/* Navigation controls - active during explanation */}
              {!showScreenRecordingInstructions && (
                <div className="flex items-center space-x-3">
                  <Button onClick={handlePrevStep} variant="outline" size="icon">
                    <ArrowLeft className="h-4 w-4" />
                  </Button>

                  <div className="px-2 py-1 bg-red-100 rounded text-xs">
                    {currentStep}/{revealSteps.length}
                  </div>

                  <Button onClick={handleNextStep} variant="outline" size="icon">
                    <ArrowRight className="h-4 w-4" />
                  </Button>

                  <Button onClick={toggleCamera} variant="ghost" size="icon">
                    <Camera className={`h-4 w-4 ${showCamera ? 'text-green-600' : 'text-slate-600'}`} />
                  </Button>
                </div>
              )}

              {/* Back to start button */}
              {currentStep > 0 && (
                <div className="absolute left-4">
                  <Button
                    onClick={() => setCurrentStep(0)}
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  )
}