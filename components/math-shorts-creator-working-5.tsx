"use client"
import React, { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Camera, Upload, ArrowRight, X, Mic } from "lucide-react"

interface RevealStep {
  revealHeight: number
  description: string
}

export default function MathShortsCreator() {
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

  const processImage = useCallback(async (dataUrl: string) => {
    return new Promise<void>((resolve, reject) => {
      const img = new window.Image()
      img.onload = async () => {
        try {
          const width = img.naturalWidth
          const height = img.naturalHeight
          const aspectRatio = width / height
          const isPortrait = height > width
          
          console.log(`📱 Image dimensions: ${width}x${height}, aspect ratio: ${aspectRatio.toFixed(2)}, portrait: ${isPortrait}`)
          
          setImageDimensions({ 
            width, 
            height, 
            isPortrait,
            aspectRatio
          })
          
          const steps = await detectTextLinesForReveal(img)
          setRevealSteps(steps)
          
          // Check if no steps were detected
          if (steps.length === 0) {
            console.warn('⚠️ No text lines detected in image')
            // Create fallback steps based on image height
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
        } catch (error) {
          console.error('❌ Error in image processing:', error)
          reject(error)
        }
      }
      img.onerror = (e) => {
        console.error('❌ Error loading image:', e)
        reject(new Error('Failed to load image. Please try a different image.'))
      }
      img.src = dataUrl
    })
  }, [detectTextLinesForReveal])

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
      console.log('🚀 Initializing Math Shorts Creator...')
      
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
    return revealSteps[currentStep - 1].revealHeight
  }

  const currentImageSrc = getCurrentImageSrc()

  // App initialization loader
  if (!isAppInitialized) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="mb-6">
            <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Camera className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Math Shorts Creator</h1>
            <p className="text-gray-600">Preparing AI for Math Fast APP</p>
          </div>
          
          <div className="space-y-4 mb-6">
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-sm text-gray-700">Loading image processing...</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" style={{ animationDelay: '0.3s' }}></div>
              <span className="text-sm text-gray-700">Initializing text detection...</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" style={{ animationDelay: '0.6s' }}></div>
              <span className="text-sm text-gray-700">Setting up camera support...</span>
            </div>
          </div>
          
          <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 h-2 rounded-full animate-pulse" style={{ width: '75%' }}></div>
          </div>
          
          <p className="text-xs text-gray-500">
            Please wait while we prepare everything for the best experience
          </p>
        </div>
      </div>
    )
  }

  // Camera Options Modal
  if (showCameraOptions) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-center mb-6 text-gray-900">Choose Recording Mode</h2>
          
          <div className="space-y-4 mb-6">
            <Button
              onClick={chooseCameraMode}
              className="w-full py-4 text-lg bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center space-x-3"
            >
              <Camera className="h-6 w-6" />
              <span>Camera + Voice</span>
            </Button>
            
            <Button
              onClick={chooseAudioOnly}
              variant="outline"
              className="w-full py-4 text-lg border-2 border-gray-300 hover:bg-gray-50 rounded-lg flex items-center justify-center space-x-3"
            >
              <Mic className="h-6 w-6" />
              <span>Voice Only</span>
            </Button>
          </div>
          
          <p className="text-sm text-gray-600 text-center">
            Choose camera + voice to show your face, or voice only for audio explanation
          </p>
        </div>
      </div>
    )
  }

  // Camera Loading States
  if (cameraState === 'requesting') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6 text-center">
          <h2 className="text-xl font-bold mb-4 text-gray-900">Requesting Camera Access</h2>
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Please allow camera access when prompted</p>
        </div>
      </div>
    )
  }

  if (cameraState === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        {/* Hidden video element for camera setup */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ display: 'none' }}
        />
        
        <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6 text-center">
          <h2 className="text-xl font-bold mb-4 text-gray-900">Starting Camera</h2>
          <div className="animate-pulse h-8 w-8 bg-blue-600 rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600 mb-4">Camera is starting up...</p>
          
          {/* Debug info */}
          <div className="text-xs text-gray-500 bg-gray-100 p-2 rounded">
            <p>Debug: Check browser console for camera logs</p>
            <p>Stream: {cameraStream ? 'Active' : 'None'}</p>
            <p>Video element: {videoRef.current ? 'Found' : 'Missing'}</p>
          </div>
          
          {/* Emergency skip button */}
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
        </div>
      </div>
    )
  }

  if (cameraState === 'denied') {
    const isSecure = typeof window !== 'undefined' && (location.protocol === 'https:' || location.hostname === 'localhost')
    const isMobile = typeof window !== 'undefined' && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6 text-center">
          <h2 className="text-xl font-bold mb-4 text-gray-900">Camera Access Issue</h2>
          
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
          
          <p className="text-gray-600 mb-6">You can still record with voice only</p>
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
        </div>
      </div>
    )
  }
  if (showScreenRecordingInstructions) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-bold text-center mb-6 text-gray-900">Ready to Record!</h2>
          
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
                <p className="text-sm text-purple-700">Start revealing your math problem</p>
              </div>
            </div>
          </div>
          
          <div className="space-y-3">
            <Button
              onClick={handleReadyToRecord}
              className="w-full py-3 text-lg bg-green-600 hover:bg-green-700 text-white"
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
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4 sm:p-6 md:p-8">
      <h1 className="text-3xl font-bold text-center mb-6 text-gray-900">Math Shorts Creator</h1>

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {imageList.length === 0 && (
        <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6 text-center">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Step 1: Upload Math Problem Images</h2>
          
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800 mb-3">{error}</p>
              <div className="flex gap-2 justify-center">
                {retryCount < 3 && (
                  <Button
                    onClick={handleRetry}
                    variant="outline"
                    className="text-sm py-1 px-3 border-red-300 text-red-700 hover:bg-red-50"
                  >
                    Try Again ({3 - retryCount} left)
                  </Button>
                )}
                <Button
                  onClick={() => setError(null)}
                  variant="outline"
                  className="text-sm py-1 px-3"
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
            className="w-full py-3 text-lg bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow-md transition-colors duration-200 disabled:opacity-50"
          >
            <Upload className="mr-2 h-5 w-5" /> 
            {isProcessingLines ? 'Processing...' : 'Upload Images'}
          </Button>
          <p className="text-sm text-gray-500 mt-3">Upload one or more clear images of your math problems to reveal step by step.</p>
        </div>
      )}

      {currentImageSrc && (
        <div className={`w-full bg-white rounded-lg shadow-lg p-6 relative overflow-hidden ${
          imageDimensions?.isPortrait ? 'max-w-md' : 'max-w-2xl'
        }`}>
          <h2 className="text-xl font-semibold mb-4 text-gray-800">
            Step 2: Reveal Math Problem Line by Line
            {imageDimensions?.isPortrait && (
              <span className="ml-2 text-sm bg-green-100 text-green-800 px-2 py-1 rounded-full">
                📱 Portrait Mode - Perfect for Shorts!
              </span>
            )}
            {imageDimensions && !imageDimensions.isPortrait && imageDimensions.aspectRatio < 1.5 && (
              <span className="ml-2 text-sm bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full">
                ⚠️ Square Mode - Consider portrait for better Shorts
              </span>
            )}
            {imageDimensions && !imageDimensions.isPortrait && imageDimensions.aspectRatio >= 1.5 && (
              <span className="ml-2 text-sm bg-orange-100 text-orange-800 px-2 py-1 rounded-full">
                📺 Landscape Mode - Not ideal for Shorts
              </span>
            )}
          </h2>
          
          <div
            className={`relative w-full mx-auto border border-gray-300 rounded-md overflow-hidden ${
              imageDimensions?.isPortrait ? 'max-w-sm' : 'max-w-full'
            }`}
            style={{
              paddingBottom: imageDimensions 
                ? `${(imageDimensions.height / imageDimensions.width) * 100}%` 
                : "56.25%",
              height: 0,
              maxHeight: imageDimensions?.isPortrait ? '70vh' : '60vh'
            }}
          >
            <img
              src={currentImageSrc}
              alt="Math problem"
              className="absolute inset-0 w-full h-full object-contain"
              ref={imageRef}
            />
            
            {isProcessingLines && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-lg font-semibold z-20">
                <div className="text-center">
                  <div className="animate-spin h-8 w-8 border-4 border-white border-t-transparent rounded-full mx-auto mb-3"></div>
                  Analyzing math problem...
                  {retryCount > 0 && <div className="text-sm mt-1">Retry #{retryCount}</div>}
                </div>
              </div>
            )}
            
            {error && !isProcessingLines && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 text-white z-20">
                <div className="text-center p-4">
                  <p className="font-semibold mb-3">Processing Failed</p>
                  <p className="text-sm mb-4">{error}</p>
                  <div className="flex gap-2 justify-center">
                    {retryCount < 3 && (
                      <Button
                        onClick={handleRetry}
                        className="bg-white text-red-900 hover:bg-gray-100 text-sm py-1 px-3"
                      >
                        Retry ({3 - retryCount} left)
                      </Button>
                    )}
                    <Button
                      onClick={handleReset}
                      variant="outline"
                      className="border-white text-white hover:bg-white hover:text-red-900 text-sm py-1 px-3"
                    >
                      Start Over
                    </Button>
                  </div>
                </div>
              </div>
            )}
            
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

          {/* Camera overlay or audio indicator */}
          {cameraState === 'ready' && cameraStream && (
            <div className={`absolute ${
              imageDimensions?.isPortrait ? 'top-4 left-4' : 'top-4 right-4'
            } w-24 h-24 sm:w-32 sm:h-32 bg-black rounded-full overflow-hidden border-2 border-white shadow-lg z-30`}>
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
                className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/50 text-white hover:bg-black/70"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {cameraState === 'audio-only' && (
            <div className={`absolute ${
              imageDimensions?.isPortrait ? 'top-4 left-4' : 'top-4 right-4'
            } w-16 h-16 bg-green-600 rounded-full flex items-center justify-center border-2 border-white shadow-lg z-30`}>
              <Mic className="h-8 w-8 text-white" />
            </div>
          )}

          <div className="mt-6 flex flex-col sm:flex-row justify-center gap-4">
            {currentStep === 0 && revealSteps.length > 0 && !isProcessingLines && cameraState === 'none' && (
              <Button
                onClick={handleStartRecording}
                className="w-full sm:w-auto py-3 text-lg bg-green-600 hover:bg-green-700 text-white rounded-md shadow-md transition-colors duration-200"
              >
                <Camera className="mr-2 h-5 w-5" /> Start Recording & Reveal
              </Button>
            )}
            
            {(cameraState === 'ready' || cameraState === 'audio-only') && currentStep === 0 && (
              <Button
                onClick={() => {
                  console.log('🚀 Starting reveal, setting currentStep to 1')
                  setCurrentStep(1)
                }}
                className="w-full sm:w-auto py-3 text-lg bg-purple-600 hover:bg-purple-700 text-white rounded-md shadow-md transition-colors duration-200"
              >
                <ArrowRight className="mr-2 h-5 w-5" />
                Start Revealing
              </Button>
            )}
            
            {currentStep > 0 && (cameraState === 'ready' || cameraState === 'audio-only') && (
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    console.log(`🔙 Previous step: ${currentStep} -> ${currentStep - 1}`)
                    handlePrevStep()
                  }}
                  disabled={currentStep <= 1 && currentImageIndex <= 0}
                  className="py-3 text-lg bg-gray-600 hover:bg-gray-700 text-white rounded-md shadow-md transition-colors duration-200 disabled:opacity-50"
                >
                  <ArrowRight className="mr-2 h-5 w-5 rotate-180" />
                  Previous
                </Button>
                <Button
                  onClick={() => {
                    console.log(`🔜 Next step: ${currentStep} -> ${currentStep + 1}, total steps: ${revealSteps.length}`)
                    handleNextStep()
                  }}
                  disabled={currentStep >= revealSteps.length && currentImageIndex >= imageList.length - 1}
                  className="py-3 text-lg bg-purple-600 hover:bg-purple-700 text-white rounded-md shadow-md transition-colors duration-200 disabled:opacity-50"
                >
                  <ArrowRight className="mr-2 h-5 w-5" />
                  Next
                </Button>
              </div>
            )}
            
            <Button
              onClick={handleReset}
              variant="outline"
              className="w-full sm:w-auto py-3 text-lg border-gray-300 text-gray-700 hover:bg-gray-100 rounded-md shadow-md transition-colors duration-200"
            >
              Reset
            </Button>
          </div>
          
          {currentStep === 0 && revealSteps.length > 0 && !isProcessingLines && cameraState === 'none' && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 text-center">
                <strong>Ready to record!</strong><br/>
                Found {revealSteps.length} steps to reveal. 
                {imageDimensions?.isPortrait 
                  ? " Perfect portrait aspect ratio for YouTube Shorts!" 
                  : " Consider using portrait images for better YouTube Shorts format."
                }<br/>
                Click "Start Recording & Reveal" to begin.
              </p>
            </div>
          )}

          {(cameraState === 'ready' || cameraState === 'audio-only') && currentStep === 0 && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 text-center">
                <strong>Ready to reveal!</strong><br/>
                {cameraState === 'ready' ? 'Camera is ready.' : 'Voice-only mode active.'} Click "Start Revealing" to begin.<br/>
                <span className="text-xs">Debug: currentStep={currentStep}, revealSteps={revealSteps.length}</span>
              </p>
            </div>
          )}
          
          {currentStep > 0 && (cameraState === 'ready' || cameraState === 'audio-only') && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 text-center">
                <strong>Recording in progress!</strong><br/>
                Step {currentStep} of {revealSteps.length} - Use Previous/Next to control reveal<br/>
                <span className="text-xs">Debug: Next disabled? {currentStep >= revealSteps.length && currentImageIndex >= imageList.length - 1}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}