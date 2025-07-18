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
  const [cameraState, setCameraState] = useState<'none' | 'requesting' | 'loading' | 'ready' | 'denied' | 'audio-only'>('none')
  const [showCameraOptions, setShowCameraOptions] = useState(false)
  const [isAppInitialized, setIsAppInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [imageDimensions, setImageDimensions] = useState<{
    width: number
    height: number
    isPortrait: boolean
    aspectRatio: number
  } | null>(null)
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

  const startCamera = useCallback(async () => {
    console.log('🎥 Starting camera process...')
    setCameraState('loading') // Set to loading first to render video element
    
    try {
      // Check if mediaDevices is available
      if (!navigator.mediaDevices) {
        console.error('🎥 navigator.mediaDevices not available')
        throw new Error('Camera not supported on this device/browser')
      }
      
      // Check if getUserMedia is available
      if (!navigator.mediaDevices.getUserMedia) {
        console.error('🎥 getUserMedia not available')
        throw new Error('Camera access not supported on this device/browser')
      }
      
      // Check if we're on HTTPS (required for mobile)
      const isSecure = location.protocol === 'https:' || location.hostname === 'localhost'
      if (!isSecure) {
        console.error('🎥 Not on HTTPS - camera may not work on mobile')
      }
      
      console.log('🎥 Requesting camera access...')
      console.log('🎥 Protocol:', location.protocol)
      console.log('🎥 Hostname:', location.hostname)
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          facingMode: 'user', // Front camera
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      })
      console.log('🎥 Camera access granted, stream received:', stream)
      
      setCameraStream(stream)
      
      // Wait a bit for video element to be available
      setTimeout(() => {
        if (videoRef.current) {
          console.log('🎥 Video element found, setting up...')
          videoRef.current.srcObject = stream
          
          // Set up multiple ways to detect when camera is ready
          const markAsReady = () => {
            console.log('🎥 Camera marked as ready!')
            setCameraState('ready')
            // Note: Stream will be attached to visible video via useEffect
          }
          
          // Primary: onloadedmetadata event
          videoRef.current.onloadedmetadata = () => {
            console.log('🎥 onloadedmetadata fired')
            markAsReady()
          }
          
          // Fallback: oncanplay event
          videoRef.current.oncanplay = () => {
            console.log('🎥 oncanplay fired')
            markAsReady()
          }
          
          // Additional events for debugging
          videoRef.current.onloadstart = () => console.log('🎥 onloadstart fired')
          videoRef.current.onloadeddata = () => console.log('🎥 onloadeddata fired')
          videoRef.current.oncanplaythrough = () => console.log('🎥 oncanplaythrough fired')
          videoRef.current.onplaying = () => console.log('🎥 onplaying fired')
          videoRef.current.onerror = (e) => console.error('🎥 Video error:', e)
          
          // Final fallback: timeout after 3 seconds
          const timeoutId = setTimeout(() => {
            console.log('🎥 Camera ready via timeout fallback (3s)')
            markAsReady()
          }, 3000)
          
          // Clear timeout if camera loads normally
          videoRef.current.addEventListener('loadedmetadata', () => {
            console.log('🎥 Clearing timeout - metadata loaded')
            clearTimeout(timeoutId)
          }, { once: true })
          
          console.log('🎥 Calling video.play()...')
          const playPromise = videoRef.current.play()
          
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                console.log('🎥 Video play() succeeded')
              })
              .catch((error) => {
                console.error('🎥 Video play() failed:', error)
              })
          }
          
          console.log('🎥 Video setup complete, waiting for events...')
        } else {
          console.error('🎥 Video element still not found!')
          setCameraState('denied')
        }
      }, 200) // Wait 200ms for render
      
    } catch (err) {
      console.error("🎥 Error accessing camera:", err)
      
      // Type-safe error handling
      if (err instanceof Error) {
        console.error("🎥 Error details:", {
          name: err.name,
          message: err.message,
          code: (err as any).code || 'unknown'
        })
      } else {
        console.error("🎥 Unknown error type:", err)
      }
      
      setCameraState('denied')
    }
  }, [])

  const chooseAudioOnly = useCallback(() => {
    setCameraState('audio-only')
    setShowCameraOptions(false)
  }, [])

  const chooseCameraMode = useCallback(() => {
    setShowCameraOptions(false)
    startCamera() // Directly call startCamera
  }, [startCamera])

  // Initialize app on mount
  useEffect(() => {
    const initializeApp = async () => {
      console.log('🚀 Initializing Teacher Shorts Creator...')
      
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
    if (cameraState === 'ready' && cameraStream && visibleVideoRef.current) {
      console.log('🎥 Attaching stream to visible video element')
      visibleVideoRef.current.srcObject = cameraStream
      visibleVideoRef.current.play().catch(console.error)
    }
  }, [cameraState, cameraStream])

  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop())
      setCameraStream(null)
    }
    setCameraState('none')
  }, [cameraStream])

  const handleStartRecording = useCallback(() => {
    // This function is no longer needed since we go directly to instructions
    // after upload, but keeping it for any edge cases
    setShowScreenRecordingInstructions(true)
  }, [])

  const handleReadyToRecord = useCallback(() => {
    setShowScreenRecordingInstructions(false)
    setShowCameraOptions(true)
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
    setCameraState('none')
    setShowCameraOptions(false)
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
    // Set viewport meta tag to prevent zooming and ensure proper mobile display
    const viewport = document.querySelector('meta[name=viewport]');
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    } else {
      const meta = document.createElement('meta');
      meta.name = 'viewport';
      meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
      document.getElementsByTagName('head')[0].appendChild(meta);
    }

    // Prevent body scroll and zoom
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
    document.documentElement.style.overflow = 'hidden';

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.height = '';
      document.documentElement.style.overflow = '';
    };
  }, []);

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
              <h1 className="text-2xl font-bold text-slate-900 mb-2">Teacher Shorts</h1>
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

  // Camera Options Modal
  if (showCameraOptions) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-4 overflow-hidden">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <h2 className="text-xl font-bold text-center mb-6 text-slate-900">Choose Recording Mode</h2>
            
            <div className="space-y-4 mb-6">
              <Button
                onClick={chooseCameraMode}
                className="w-full py-4 text-lg bg-purple-600 hover:bg-purple-700 text-white rounded-lg flex items-center justify-center space-x-3"
              >
                <Camera className="h-6 w-6" />
                <span>Camera + Voice</span>
              </Button>
              
              <Button
                onClick={chooseAudioOnly}
                variant="outline"
                className="w-full py-4 text-lg border-2 border-slate-300 hover:bg-slate-50 rounded-lg flex items-center justify-center space-x-3"
              >
                <Mic className="h-6 w-6" />
                <span>Voice Only</span>
              </Button>
            </div>
            
            <p className="text-sm text-slate-600 text-center">
              Choose camera + voice to show your face, or voice only for audio explanation
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Camera Loading States
  if (cameraState === 'requesting') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-4 overflow-hidden">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <h2 className="text-xl font-bold mb-4 text-slate-900">Requesting Camera Access</h2>
            <div className="animate-spin h-8 w-8 border-4 border-purple-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-slate-600">Please allow camera access when prompted</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (cameraState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-4 overflow-hidden">
        {/* Hidden video element for camera setup */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ display: 'none' }}
        />
        
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <h2 className="text-xl font-bold mb-4 text-slate-900">Starting Camera</h2>
            <div className="animate-pulse h-8 w-8 bg-purple-600 rounded-full mx-auto mb-4"></div>
            <p className="text-slate-600 mb-4">Camera is starting up...</p>
            
            <Button
              onClick={() => {
                console.log('🎥 Emergency skip - forcing ready state')
                setCameraState('ready')
              }}
              variant="outline"
              className="mt-4 text-sm"
            >
              Skip (if stuck)
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (cameraState === 'denied') {
    const isSecure = typeof window !== 'undefined' && (location.protocol === 'https:' || location.hostname === 'localhost')
    const isMobile = typeof window !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-4 overflow-hidden">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">
            <h2 className="text-xl font-bold mb-4 text-slate-900">Camera Access Issue</h2>
            
            {!isSecure && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-800">
                  <strong>Security Issue:</strong> Camera requires HTTPS on mobile devices. 
                  This site is using HTTP which blocks camera access.
                </p>
              </div>
            )}
            
            {isMobile && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Mobile Tips:</strong><br/>
                  • Make sure camera permission is enabled<br/>
                  • Try refreshing the page<br/>
                  • Check if other apps are using the camera<br/>
                  {!isSecure && '• Use HTTPS version of this site'}
                </p>
              </div>
            )}
            
            <p className="text-slate-600 mb-6">You can still record with voice only</p>
            <div className="space-y-3">
              <Button
                onClick={chooseAudioOnly}
                className="w-full py-3 bg-green-600 hover:bg-green-700 text-white"
              >
                <Mic className="mr-2 h-5 w-5" />
                Continue with Voice Only
              </Button>
              <Button
                onClick={() => setShowCameraOptions(true)}
                variant="outline"
                className="w-full py-2"
              >
                Try Camera Again
              </Button>
            </div>
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
            <h2 className="text-xl font-bold text-center mb-6 text-slate-900">Ready to Record!</h2>
            
            <div className="space-y-4 mb-6">
              <div className="flex items-center space-x-3 p-3 bg-blue-50 rounded-lg">
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">1</div>
                <div>
                  <p className="font-medium text-blue-900">Start Screen Recording</p>
                  <p className="text-sm text-blue-700">Open Control Center → Screen Recording</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3 p-3 bg-green-50 rounded-lg">
                <div className="w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">2</div>
                <div>
                  <p className="font-medium text-green-900">Come Back to This App</p>
                  <p className="text-sm text-green-700">Switch back when recording starts</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-3 p-3 bg-purple-50 rounded-lg">
                <div className="w-8 h-8 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold">3</div>
                <div>
                  <p className="font-medium text-purple-900">Click "I'm Ready"</p>
                  <p className="text-sm text-slate-600">Start revealing your math problem</p>
                </div>
              </div>
            </div>
            
            <div className="space-y-3">
              <Button
                onClick={handleReadyToRecord}
                className="w-full py-3 text-lg bg-purple-600 hover:bg-purple-700 text-white"
              >
                I'm Ready - Start Revealing!
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
                <h2 className="text-xl font-semibold mb-2 text-slate-800">Teacher Shorts</h2>
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

      {/* Recording Phase (Step 2) - Clean fullscreen layout */}
      {currentImageSrc && (
        <div className="relative h-screen flex flex-col overflow-hidden bg-slate-50">
          {/* Professional Header with branding - SINGLE TITLE */}
          <div className="flex-shrink-0 py-4 px-4 text-center bg-white shadow-sm relative">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              Teacher Shorts
            </h1>
            {/* Reset button as close icon - in header */}
            <Button
              onClick={handleReset}
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 h-8 w-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 z-50"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Main content area with fixed card size */}
          <div className="flex-1 flex items-center justify-center p-4">
            {/* Fixed size card container */}
            <div className="relative w-full max-w-sm">
              <div 
                className="relative w-full bg-white rounded-2xl overflow-hidden shadow-xl"
                style={{
                  height: 'calc(100vh - 180px)', // Fixed height accounting for header and controls
                  aspectRatio: '9/16'
                }}
              >
                <img
                  src={currentImageSrc}
                  alt="Math problem"
                  className="absolute inset-0 w-full h-full object-contain bg-white" // Back to object-contain with white background
                  ref={imageRef}
                />
                
                {/* Processing overlay */}
                {isProcessingLines && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white z-20">
                    <div className="text-center">
                      <div className="animate-spin h-8 w-8 border-4 border-white border-t-transparent rounded-full mx-auto mb-3"></div>
                      <p className="text-sm">Analyzing...</p>
                    </div>
                  </div>
                )}
                
                {/* Error overlay */}
                {error && !isProcessingLines && (
                  <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 text-white z-20">
                    <div className="text-center p-4">
                      <p className="font-semibold mb-3">Processing Failed</p>
                      <div className="flex gap-2 justify-center">
                        {retryCount < 3 && (
                          <Button
                            onClick={handleRetry}
                            size="sm"
                            className="bg-white text-red-900 hover:bg-gray-100"
                          >
                            Retry
                          </Button>
                        )}
                        <Button
                          onClick={handleReset}
                          variant="outline"
                          size="sm"
                          className="border-white text-white hover:bg-white hover:text-red-900"
                        >
                          Start Over
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                
                {/* Reveal overlay */}
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
            </div>
          </div>

          {/* Camera overlay - positioned OUTSIDE the card, in top area */}
          {cameraState === 'ready' && cameraStream && (
            <div className="absolute top-16 right-4 w-16 h-16 bg-black rounded-full overflow-hidden border-2 border-white shadow-lg z-30">
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
                onClick={stopCamera}
                className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white hover:bg-red-600 p-0"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Audio-only indicator - positioned OUTSIDE the card */}
          {cameraState === 'audio-only' && (
            <div className="absolute top-16 right-4 w-12 h-12 bg-green-600 rounded-full flex items-center justify-center border-2 border-white shadow-lg z-30">
              <Mic className="h-5 w-5 text-white" />
            </div>
          )}

          {/* Bottom controls - OUTSIDE the card, in separate area */}
          <div className="flex-shrink-0 pb-6 pt-2">
            <div className="flex justify-center">
              <div className="flex items-center space-x-4">
                {/* Initial start button */}
                {currentStep === 0 && revealSteps.length > 0 && !isProcessingLines && cameraState === 'none' && (
                  <Button
                    onClick={handleStartRecording}
                    size="lg"
                    className="bg-purple-600 hover:bg-purple-700 text-white shadow-lg"
                  >
                    <Camera className="mr-2 h-5 w-5" />
                    Start Recording
                  </Button>
                )}
                
                {/* Ready to reveal button */}
                {(cameraState === 'ready' || cameraState === 'audio-only') && currentStep === 0 && (
                  <Button
                    onClick={() => setCurrentStep(1)}
                    size="lg"
                    className="bg-purple-600 hover:bg-purple-700 text-white shadow-lg"
                  >
                    Start Revealing
                  </Button>
                )}
                
                {/* Navigation controls during recording */}
                {currentStep > 0 && (cameraState === 'ready' || cameraState === 'audio-only') && (
                  <div className="flex items-center space-x-3">
                    <Button
                      onClick={handlePrevStep}
                      disabled={currentStep <= 1 && currentImageIndex <= 0}
                      size="sm"
                      variant="outline"
                      className="bg-white hover:bg-slate-50 shadow-lg border-slate-300"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    
                    <Button
                      onClick={handleNextStep}
                      disabled={currentStep >= revealSteps.length && currentImageIndex >= imageList.length - 1}
                      size="sm"
                      variant="outline"
                      className="bg-white hover:bg-slate-50 shadow-lg border-slate-300"
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}