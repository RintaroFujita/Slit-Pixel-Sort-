class SlitScanEffect {
    constructor() {
        this.sourceCanvas = document.getElementById('sourceCanvas');
        this.outputCanvas = document.getElementById('outputCanvas');
        this.videoPreview = document.getElementById('videoPreview');
        this.sourceCtx = this.sourceCanvas.getContext('2d');
        
        // 基本的な2Dコンテキストを先に初期化
        this.outputCtx = this.outputCanvas.getContext('2d');
        
        this.isVideo = false;
        this.video = null;
        this.animationId = null;
        this.currentFrame = 0;
        
        // 動画処理用の変数
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.originalVideoDuration = 0;
        this.loadTimeout = null;
        
        // 自動アニメーション用の変数
        this.autoMode = false;
        this.autoAnimationId = null;
        this.autoTime = 0;
        this.recordingAnimationId = null;
        this.recordingTime = 0;
        this.lastFrameTime = 0;
        this.lastAutoFrameTime = 0;
        this.lastRecordingFrameTime = 0;
        this.lastAnimateFrameTime = 0;
        
        // パフォーマンス監視
        this.frameCount = 0;
        this.lastPerformanceCheck = performance.now();
        this.fpsHistory = [];
        
        // ポップアップウィンドウ関連
        this.popupWindow = null;
        this.popupUpdateInterval = null;
        
        // Webカメラ関連
        this.cameraStream = null;
        this.cameraVideo = null;
        this.isCameraActive = false;
        this.cameraAnimationId = null;
        
        // 高度な機能の初期化（エラーが発生しても基本機能は動作）
        try {
            // WebGL GPU レンダリングの初期化
            this.initWebGL();
        } catch (error) {
            console.warn('WebGL initialization failed, using 2D canvas only:', error);
            this.useWebGL = false;
        }
        
        try {
            // Web Worker の初期化
            this.initWebWorkers();
        } catch (error) {
            console.warn('Web Workers initialization failed, using single-threaded processing:', error);
            this.useWorkers = false;
        }
        
        // DOM要素の存在確認
        console.log('Checking DOM elements...');
        console.log('uploadBtn:', document.getElementById('uploadBtn'));
        console.log('imageInput:', document.getElementById('imageInput'));
        console.log('uploadArea:', document.getElementById('uploadArea'));
        
        this.setupEventListeners();
    }

    initWebGL() {
        try {
            console.log('Initializing WebGL...');
            
            // WebGLコンテキストの作成（高パフォーマンス設定）
            this.gl = this.outputCanvas.getContext('webgl2', {
                alpha: false,
                antialias: true,
                depth: false,
                stencil: false,
                preserveDrawingBuffer: false,
                powerPreference: 'high-performance'
            }) || this.outputCanvas.getContext('webgl', {
                alpha: false,
                antialias: true,
                depth: false,
                stencil: false,
                preserveDrawingBuffer: false,
                powerPreference: 'high-performance'
            });
            
            if (this.gl) {
                console.log('WebGL GPU acceleration enabled');
                console.log('WebGL Version:', this.gl.getParameter(this.gl.VERSION));
                console.log('WebGL Vendor:', this.gl.getParameter(this.gl.VENDOR));
                console.log('WebGL Renderer:', this.gl.getParameter(this.gl.RENDERER));
                this.useWebGL = true;
                this.setupWebGLShaders();
            } else {
                console.log('WebGL not available, using 2D canvas');
                this.useWebGL = false;
            }
        } catch (error) {
            console.warn('WebGL initialization failed:', error);
            this.useWebGL = false;
        }
    }
    
    setupWebGLShaders() {
        try {
            // 頂点シェーダー
            const vertexShaderSource = `
                attribute vec2 a_position;
                attribute vec2 a_texCoord;
                varying vec2 v_texCoord;
                
                void main() {
                    gl_Position = vec4(a_position, 0.0, 1.0);
                    v_texCoord = a_texCoord;
                }
            `;
            
            // フラグメントシェーダー（スリットスキャン効果）
            const fragmentShaderSource = `
                precision mediump float;
                uniform sampler2D u_image;
                uniform vec2 u_resolution;
                uniform float u_intensity;
                uniform float u_time;
                
                varying vec2 v_texCoord;
                
                void main() {
                    vec2 uv = v_texCoord;
                    vec2 center = vec2(0.5);
                    
                    // スリットスキャン効果
                    float offset = u_intensity * 0.1;
                    vec2 distorted = uv;
                    
                    // 水平方向の歪み
                    distorted.x += sin(uv.y * 10.0 + u_time) * offset;
                    
                    // 垂直方向の歪み
                    distorted.y += sin(uv.x * 10.0 + u_time) * offset;
                    
                    // 放射状の歪み
                    float dist = distance(uv, center);
                    float angle = atan(uv.y - center.y, uv.x - center.x);
                    distorted = center + vec2(cos(angle + sin(dist * 5.0 + u_time) * offset),
                                            sin(angle + sin(dist * 5.0 + u_time) * offset)) * dist;
                    
                    // テクスチャサンプリング
                    gl_FragColor = texture2D(u_image, distorted);
                }
            `;
            
            // シェーダーのコンパイル
            this.vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
            this.fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);
            
            if (!this.vertexShader || !this.fragmentShader) {
                throw new Error('Shader compilation failed');
            }
            
            // プログラムの作成
            this.program = this.createProgram(this.vertexShader, this.fragmentShader);
            
            if (!this.program) {
                throw new Error('Program linking failed');
            }
            
            // 属性とユニフォームの位置を取得
            this.positionLocation = this.gl.getAttribLocation(this.program, 'a_position');
            this.texCoordLocation = this.gl.getAttribLocation(this.program, 'a_texCoord');
            this.imageLocation = this.gl.getUniformLocation(this.program, 'u_image');
            this.resolutionLocation = this.gl.getUniformLocation(this.program, 'u_resolution');
            this.intensityLocation = this.gl.getUniformLocation(this.program, 'u_intensity');
            this.timeLocation = this.gl.getUniformLocation(this.program, 'u_time');
            
            // テクスチャの作成
            this.texture = this.gl.createTexture();
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
            this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
            
            // バッファの作成
            this.positionBuffer = this.gl.createBuffer();
            this.texCoordBuffer = this.gl.createBuffer();
            
            // 四角形の頂点データ
            const positions = [
                -1, -1,
                 1, -1,
                -1,  1,
                 1,  1,
            ];
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(positions), this.gl.STATIC_DRAW);
            
            // テクスチャ座標
            const texCoords = [
                0, 1,
                1, 1,
                0, 0,
                1, 0,
            ];
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(texCoords), this.gl.STATIC_DRAW);
            
            console.log('WebGL shaders setup completed successfully');
        } catch (error) {
            console.error('WebGL shaders setup failed:', error);
            this.useWebGL = false;
        }
    }
    
    createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }
        return shader;
    }
    
    createProgram(vertexShader, fragmentShader) {
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);
        
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program linking error:', this.gl.getProgramInfoLog(program));
            this.gl.deleteProgram(program);
            return null;
        }
        return program;
    }
    
    initWebWorkers() {
        try {
            // Web Workers のサポート確認
            if (typeof Worker === 'undefined') {
                throw new Error('Web Workers not supported');
            }
            
            // CPU コア数に基づいてワーカー数を決定
            const cpuCores = navigator.hardwareConcurrency || 4;
            this.workerCount = Math.min(cpuCores, 4); // 最大4個まで（安全のため）
            this.workers = [];
            this.workerQueue = [];
            this.activeWorkers = 0;
            
            console.log(`Initializing ${this.workerCount} Web Workers for CPU cores: ${cpuCores}`);
            
            for (let i = 0; i < this.workerCount; i++) {
                try {
                    const worker = new Worker('worker.js');
                    worker.onmessage = (e) => this.handleWorkerMessage(e, i);
                    worker.onerror = (error) => {
                        console.error(`Worker ${i} error:`, error);
                        this.useWorkers = false;
                    };
                    this.workers.push(worker);
                } catch (workerError) {
                    console.warn(`Failed to create worker ${i}:`, workerError);
                    // ワーカーの作成に失敗した場合は、残りのワーカーで続行
                    continue;
                }
            }
            
            // 少なくとも1つのワーカーが作成できた場合のみ有効化
            if (this.workers.length === 0) {
                throw new Error('No workers could be created');
            }
            
            this.useWorkers = true;
        } catch (error) {
            console.warn('Web Workers not available:', error);
            this.useWorkers = false;
        }
    }
    
    handleWorkerMessage(e, workerId) {
        const { type, data } = e.data;
        
        if (type.endsWith('-result')) {
            // ワーカー処理完了
            this.activeWorkers--;
            
            // 結果をキャンバスに適用
            const imageData = new ImageData(data, this.outputCanvas.width, this.outputCanvas.height);
            this.outputCtx.putImageData(imageData, 0, 0);
            
            // 次のタスクを処理
            this.processWorkerQueue();
        }
    }
    
    processWorkerQueue() {
        if (this.workerQueue.length > 0 && this.activeWorkers < this.workerCount) {
            const task = this.workerQueue.shift();
            const availableWorker = this.workers.find(w => !w.busy);
            
            if (availableWorker) {
                availableWorker.busy = true;
                this.activeWorkers++;
                availableWorker.postMessage(task);
            }
        }
    }
    
    processWithWorkers(imageData, effectType, intensity, direction, stretchType, stretchAmount) {
        if (!this.useWorkers || this.workers.length === 0) {
            return false; // ワーカーが利用できない場合は false を返す
        }
        
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        
        // ワーカーにタスクを送信
        const task = {
            type: effectType,
            data: data,
            width: width,
            height: height,
            intensity: intensity,
            direction: direction,
            stretchType: stretchType,
            stretchAmount: stretchAmount
        };
        
        this.workerQueue.push(task);
        this.processWorkerQueue();
        
        return true; // ワーカー処理を開始した場合は true を返す
    }

    setupEventListeners() {
        // ファイル選択ボタン
        const uploadBtn = document.getElementById('uploadBtn');
        const imageInput = document.getElementById('imageInput');
        
        if (uploadBtn && imageInput) {
            uploadBtn.addEventListener('click', () => {
                imageInput.click();
            });
            imageInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this.handleFileUpload(e.target.files[0]);
                }
            });
        } else {
            console.error('Upload button element not found');
        }

        document.getElementById('applyEffect').addEventListener('click', () => {
            this.applyEffect();
        });

        // エフェクトタイプ、方向、ストレッチタイプの変更時もリアルタイム適用
        document.getElementById('effectType').addEventListener('change', () => {
            if (!this.isVideo) {
                this.processFrame();
            }
        });

        document.getElementById('direction').addEventListener('change', () => {
            if (!this.isVideo) {
                this.processFrame();
            }
        });

        document.getElementById('stretchType').addEventListener('change', () => {
            if (!this.isVideo) {
                this.processFrame();
            }
        });

        document.getElementById('downloadBtn').addEventListener('click', () => {
            this.downloadVideo();
        });

        // カメラボタン
        const cameraBtn = document.getElementById('cameraBtn');
        if (cameraBtn) {
            cameraBtn.addEventListener('click', () => {
                this.toggleCamera();
            });
        }

        // フルスクリーンボタン
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                this.toggleFullscreen();
            });
        }

        // フルスクリーン用コントロールUIのイベントリスナー
        this.setupFullscreenControls();

        // ポップアップボタン
        const popupBtn = document.getElementById('popupBtn');
        if (popupBtn) {
            popupBtn.addEventListener('click', () => {
                this.openPopupWindow();
            });
        }

        // スライダーの値を表示
        document.getElementById('intensity').addEventListener('input', (e) => {
            const value = e.target.value;
            document.getElementById('intensityValue').textContent = value;
            
            // フルスクリーン用コントロールも同期
            const fullscreenIntensity = document.getElementById('fullscreenIntensity');
            if (fullscreenIntensity) {
                fullscreenIntensity.value = value;
                document.getElementById('fullscreenIntensityValue').textContent = value;
            }
            
            // 静止画またはカメラの場合、リアルタイムで適用
            if (!this.isVideo || this.isCameraActive) {
                this.processFrame();
            }
        });

        document.getElementById('stretchAmount').addEventListener('input', (e) => {
            const value = e.target.value;
            document.getElementById('stretchAmountValue').textContent = value;
            
            // フルスクリーン用コントロールも同期
            const fullscreenStretchAmount = document.getElementById('fullscreenStretchAmount');
            if (fullscreenStretchAmount) {
                fullscreenStretchAmount.value = value;
                document.getElementById('fullscreenStretchAmountValue').textContent = value;
            }
            
            // 静止画またはカメラの場合、リアルタイムで適用
            if (!this.isVideo || this.isCameraActive) {
                this.processFrame();
            }
        });

        document.getElementById('speed').addEventListener('input', (e) => {
            document.getElementById('speedValue').textContent = e.target.value;
            // 静止画またはカメラの場合、リアルタイムで適用
            if (!this.isVideo || this.isCameraActive) {
                this.processFrame();
            }
        });

        document.getElementById('autoSpeed').addEventListener('input', (e) => {
            document.getElementById('autoSpeedValue').textContent = e.target.value;
        });

        document.getElementById('recordingDuration').addEventListener('input', (e) => {
            document.getElementById('recordingDurationValue').textContent = e.target.value + 's';
        });

        // 自動モードの切り替え
        document.getElementById('autoMode').addEventListener('change', (e) => {
            this.autoMode = e.target.checked;
            const autoStatus = document.getElementById('autoStatus');
            
            if (this.autoMode) {
                this.startAutoAnimation();
                autoStatus.style.display = 'flex';
            } else {
                this.stopAutoAnimation();
                autoStatus.style.display = 'none';
            }
        });

        // 個別のオート設定の変更時にもリアルタイム適用（有効なもののみ）
        const autoCheckboxes = ['autoIntensity', 'autoStretch'];
        autoCheckboxes.forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                if ((!this.isVideo || this.isCameraActive) && !this.autoMode) {
                    this.processFrame();
                }
            });
        });

        // ドラッグ&ドロップ機能
        const uploadArea = document.getElementById('uploadArea');
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = '#4CAF50';
                uploadArea.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
                uploadArea.classList.add('dragover');
            });
            
            uploadArea.addEventListener('dragleave', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = '#666';
                uploadArea.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                uploadArea.classList.remove('dragover');
            });
            
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = '#666';
                uploadArea.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                uploadArea.classList.remove('dragover');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.handleFileUpload(files[0]);
                }
            });
        }
        
        // ページクリック時の動画再生開始（一度だけ実行）
        let clickHandlerAdded = false;
        document.addEventListener('click', () => {
            if (!clickHandlerAdded && this.isVideo && this.video && this.video.paused) {
                this.video.play().then(() => {
                    console.log('Video playback started after user interaction');
                    this.animate();
                    clickHandlerAdded = true;
                }).catch((error) => {
                    console.error('Video playback error:', error);
                });
            }
        });

        // リセットボタン
        document.getElementById('resetBtn').addEventListener('click', () => {
            this.resetCanvas();
        });

        // ドラッグ&ドロップ機能の統合
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = '#4CAF50';
                uploadArea.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
                uploadArea.classList.add('dragover');
            });
            
            uploadArea.addEventListener('dragleave', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = '#666';
                uploadArea.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                uploadArea.classList.remove('dragover');
            });
            
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = '#666';
                uploadArea.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                uploadArea.classList.remove('dragover');
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.handleFileUpload(files[0]);
                }
            });
        }

        // フルスクリーン状態の変更を監視
        document.addEventListener('fullscreenchange', () => {
            this.handleFullscreenChange();
        });
        document.addEventListener('webkitfullscreenchange', () => {
            this.handleFullscreenChange();
        });
        document.addEventListener('msfullscreenchange', () => {
            this.handleFullscreenChange();
        });

        // キーボードショートカット
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F11' || e.key === 'f') {
                e.preventDefault();
                this.toggleFullscreen();
            }
        });

        // ウィンドウリサイズ時の処理
        window.addEventListener('resize', () => {
            const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
            if (isFullscreen) {
                this.adjustCanvasForFullscreen();
            }
        });

        // ページを離れる時にカメラを停止
        window.addEventListener('beforeunload', () => {
            if (this.isCameraActive) {
                this.stopCamera();
            }
        });
    }

    handleFileUpload(file) {
        if (!file) return;

        console.log('File selected:', file.name, 'Type:', file.type, 'Size:', file.size);

        // ファイルサイズチェック
        if (file.size > 100 * 1024 * 1024) { // 100MB制限
            alert('File size is too large. Please use a file smaller than 100MB.');
            return;
        }

        // MOVファイルの特別処理
        const isMOV = file.name.toLowerCase().endsWith('.mov') || file.type === 'video/quicktime';
        if (isMOV) {
            console.log('MOV file detected, applying special handling');
            
            // MOVファイルのブラウザサポートチェック
            const video = document.createElement('video');
            const canPlayMOV = video.canPlayType('video/quicktime');
            console.log('MOV support:', canPlayMOV);
            
            if (canPlayMOV === '') {
                console.warn('MOV format may not be supported in this browser');
                if (confirm('MOV files may not work in this browser. Would you like to try anyway, or convert to MP4 first?')) {
                    // ユーザーが試行を選択
                } else {
                    return; // ユーザーがキャンセル
                }
            }
        }

        // ローディング状態を表示
        if (file.type.startsWith('video/') || isMOV) {
            document.getElementById('loadingStatus').style.display = 'flex';
        }

        const reader = new FileReader();
        
        reader.onload = (e) => {
            console.log('File loaded successfully');
            if (file.type.startsWith('video/') || isMOV) {
                this.loadVideo(e.target.result, isMOV);
            } else {
                this.loadImage(e.target.result);
            }
        };

        reader.onerror = (e) => {
            console.error('FileReader error:', e);
            alert('Failed to read file. Please try again.');
            document.getElementById('loadingStatus').style.display = 'none';
        };

        reader.readAsDataURL(file);
    }

    loadImage(src) {
        console.log('loadImage called with src:', src);
        const img = new Image();
        img.onload = () => {
            console.log('Image loaded successfully, dimensions:', img.width, 'x', img.height);
            this.isVideo = false;
            this.setupCanvasWithAspectRatio(img.width, img.height);
            this.sourceCtx.drawImage(img, 0, 0);
            this.outputCtx.drawImage(img, 0, 0);
            
            console.log('Canvas setup completed, calling processFrame');
            // 静止画の場合、初期エフェクトを適用
            this.processFrame();
            
            // Hide video preview
            this.videoPreview.style.display = 'none';
        };
        img.onerror = (error) => {
            console.error('Image loading error:', error);
        };
        img.src = src;
    }

    loadVideo(src, isMOV = false) {
        console.log('Loading video from source...', isMOV ? '(MOV file)' : '');
        
        // 既存の動画を停止
        if (this.video) {
            this.video.pause();
            this.video.src = '';
        }
        
        // 既存のアニメーションを停止
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        this.video = document.createElement('video');
        this.video.crossOrigin = 'anonymous';
        this.video.loop = true;
        this.video.muted = true;
        this.video.playsInline = true;
        this.video.controls = false;
        this.video.preload = 'metadata';
        
        // MOVファイル用の特別設定
        if (isMOV) {
            console.log('Applying MOV-specific settings');
            this.video.preload = 'auto';
        }
        
        // 動画プレビューも設定
        this.videoPreview.src = src;
        this.videoPreview.loop = true;
        this.videoPreview.muted = true;
        this.videoPreview.playsInline = true;
        this.videoPreview.controls = true;
        this.videoPreview.style.display = 'block';
        
        // 縦長動画用のプレビュー設定
        this.videoPreview.style.maxHeight = '400px';
        this.videoPreview.style.width = 'auto';
        this.videoPreview.style.height = 'auto';
        
        // 動画の読み込みエラーハンドリング
        this.video.onerror = (e) => {
            console.error('Video loading error:', e);
            console.error('Video error details:', this.video.error);
            console.error('Video readyState:', this.video.readyState);
            console.error('Video networkState:', this.video.networkState);
            document.getElementById('loadingStatus').style.display = 'none';
            
            // タイムアウトをクリア
            if (this.loadTimeout) {
                clearTimeout(this.loadTimeout);
                this.loadTimeout = null;
            }
            
            let errorMessage = 'Failed to load video. ';
            if (this.video.error) {
                switch (this.video.error.code) {
                    case 1:
                        errorMessage += 'Video format not supported. Try converting to MP4 or WebM format.';
                        break;
                    case 2:
                        errorMessage += 'Network error occurred. Check your internet connection.';
                        break;
                    case 3:
                        errorMessage += 'Video decoding failed. The video file may be corrupted.';
                        break;
                    case 4:
                        errorMessage += 'Video not supported. Try a different video format (MP4, WebM, MOV).';
                        break;
                    default:
                        errorMessage += 'Please try a different video file.';
                }
            } else {
                errorMessage += 'Please try a different video file or format.';
            }
            
            // MOVファイルの場合の追加情報
            if (isMOV) {
                errorMessage += '\n\nMOV files may not be supported in all browsers. Try converting to MP4 format using online converters.';
            }
            
            alert(errorMessage);
        };
        

        

        


        // 動画の読み込み完了
        this.video.oncanplay = () => {
            console.log('Video ready to play');
        };

        // 動画の読み込み中断
        this.video.onabort = () => {
            console.error('Video loading aborted');
            document.getElementById('loadingStatus').style.display = 'none';
        };

        // 動画の読み込み停止
        this.video.onstalled = () => {
            console.warn('Video loading stalled');
        };

        // 動画の読み込み待機
        this.video.onwaiting = () => {
            console.log('Video waiting for data');
        };

        // 動画の読み込み再開
        this.video.oncanplaythrough = () => {
            console.log('Video can play through without buffering');
        };

        // 動画の読み込み開始
        this.video.onloadstart = () => {
            console.log('Video loading started');
        };

        // 動画の読み込み進行状況
        this.video.onprogress = () => {
            console.log('Video loading in progress...');
        };
        
        this.video.src = src;
        
        // 読み込みタイムアウト設定（MOVファイルの場合は長めに設定）
        const timeoutDuration = isMOV ? 60000 : 30000; // MOVファイルは60秒、その他は30秒
        const loadTimeout = setTimeout(() => {
            if (!this.video.readyState) {
                console.error('Video loading timeout');
                let timeoutMessage = 'Video loading took too long. ';
                if (isMOV) {
                    timeoutMessage += 'MOV files may take longer to load. Try converting to MP4 format for better compatibility.';
                } else {
                    timeoutMessage += 'Please try a smaller video file or check your internet connection.';
                }
                alert(timeoutMessage);
                document.getElementById('loadingStatus').style.display = 'none';
            }
        }, timeoutDuration);
        
        // 読み込み完了時にタイムアウトをクリア
        this.video.onloadedmetadata = () => {
            clearTimeout(loadTimeout);
            console.log('Video metadata loaded:', this.video.videoWidth, 'x', this.video.videoHeight);
            console.log('Video duration:', this.video.duration);
            console.log('Video readyState:', this.video.readyState);
            
            if (this.video.videoWidth === 0 || this.video.videoHeight === 0) {
                console.error('Invalid video dimensions');
                alert('Invalid video file. Please try a different video.');
                document.getElementById('loadingStatus').style.display = 'none';
                return;
            }
            
            // 縦長動画の特別処理
            const aspectRatio = this.video.videoWidth / this.video.videoHeight;
            if (aspectRatio < 1) {
                console.log('Portrait video detected (9:16 or similar)');
                // 縦長動画の場合、キャンバスサイズを調整
                this.setupCanvasWithAspectRatio(this.video.videoWidth, this.video.videoHeight);
                // プレビューに縦長動画用のクラスを追加
                this.videoPreview.setAttribute('data-aspect', 'portrait');
            } else {
                console.log('Landscape video detected (16:9 or similar)');
                this.setupCanvasWithAspectRatio(this.video.videoWidth, this.video.videoHeight);
                // プレビューに横長動画用のクラスを追加
                this.videoPreview.setAttribute('data-aspect', 'landscape');
            }
            
            this.isVideo = true;
            this.originalVideoDuration = this.video.duration;
            
            // ローディング状態を非表示
            document.getElementById('loadingStatus').style.display = 'none';
            
            // 動画の再生開始
            this.startVideoPlayback();
        };
    }

    startVideoPlayback() {
        console.log('Starting video playback...');
        
        // 動画再生を試行
        this.video.play().then(() => {
            console.log('Video playback started successfully');
            this.applyEffect(); // エフェクト適用開始
        }).catch((error) => {
            console.error('Failed to start video playback:', error);
            
            // ユーザーインタラクションが必要な場合
            if (error.name === 'NotAllowedError') {
                console.log('Autoplay blocked, waiting for user interaction');
                
                // ページクリックで再生開始
                if (!this.clickHandlerAdded) {
                    this.clickHandlerAdded = true;
                    const clickHandler = () => {
                        if (this.video && this.isVideo) {
                            this.video.play().then(() => {
                                console.log('Video playback started after user interaction');
                                this.applyEffect();
                            }).catch((playError) => {
                                console.error('Still failed to play video:', playError);
                            });
                        }
                        document.removeEventListener('click', clickHandler);
                    };
                    document.addEventListener('click', clickHandler, { once: true });
                }
            } else {
                alert('Failed to play video. Please try again.');
            }
        });
    }

    setupCanvas(width, height) {
        this.sourceCanvas.width = width;
        this.sourceCanvas.height = height;
        this.outputCanvas.width = width;
        this.outputCanvas.height = height;
        
        // 基本的な2Dコンテキストを設定
        this.outputCtx = this.outputCanvas.getContext('2d');
        
        // 高品質レンダリング設定
        this.outputCtx.imageSmoothingEnabled = true;
        this.outputCtx.imageSmoothingQuality = 'high';
        
        // パフォーマンス最適化設定
        this.outputCtx.globalCompositeOperation = 'source-over';
        this.outputCtx.globalAlpha = 1.0;
        
        console.log(`Canvas setup: ${width}x${height}`);
    }

    setupCanvasWithAspectRatio(width, height) {
        // 高解像度対応（高パフォーマンスデバイス用）
        const maxWidth = 1920; // 高解像度対応（Full HD）
        const maxHeight = 2160; // 高解像度対応（4K対応）
        
        // アスペクト比を計算
        const aspectRatio = width / height;
        
        let newWidth, newHeight;
        
        if (width > height) {
            // 横長の動画/画像 (16:9, 4:3など)
            newWidth = Math.min(width, maxWidth);
            newHeight = newWidth / aspectRatio;
            
            if (newHeight > maxHeight) {
                newHeight = maxHeight;
                newWidth = newHeight * aspectRatio;
            }
        } else {
            // 縦長の動画/画像 (9:16, 3:4など)
            newHeight = Math.min(height, maxHeight);
            newWidth = newHeight * aspectRatio;
            
            // 縦長動画の場合、幅が小さすぎる場合は調整
            if (newWidth < 600) { // 高解像度対応
                newWidth = 600;
                newHeight = newWidth / aspectRatio;
            }
        }
        
        // 整数値に丸める
        newWidth = Math.floor(newWidth);
        newHeight = Math.floor(newHeight);
        
        console.log(`Original: ${width}x${height}, Scaled: ${newWidth}x${newHeight}, Aspect: ${aspectRatio.toFixed(2)}`);
        console.log(`Aspect ratio type: ${aspectRatio > 1 ? 'Landscape' : 'Portrait'}`);
        
        this.setupCanvas(newWidth, newHeight);
    }

    applyEffect() {
        if (this.isVideo) {
            this.animate();
        } else {
            this.processFrame();
        }
    }

    animate() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        const animate = () => {
            // フレーム制限（60FPS制限で高パフォーマンス）
            if (this.lastAnimateFrameTime && performance.now() - this.lastAnimateFrameTime < 16.67) {
                this.animationId = requestAnimationFrame(animate);
                return;
            }
            this.lastAnimateFrameTime = performance.now();
            
            // カメラまたは動画がアクティブな場合のみ処理
            if (this.isCameraActive || (this.isVideo && this.video)) {
                this.processFrame();
            }
            
            this.animationId = requestAnimationFrame(animate);
        };
        animate();
    }

    processFrame() {
        console.log('processFrame called');
        // フレーム処理の制限（120FPS制限で高パフォーマンス）
        if (this.lastFrameTime && performance.now() - this.lastFrameTime < 8.33) {
            return; // 約120FPS制限
        }
        this.lastFrameTime = performance.now();

        if (this.isCameraActive && this.cameraVideo && this.cameraVideo.readyState >= 2) {
            try {
                // カメラ映像をキャンバスサイズに合わせて描画
                this.sourceCtx.clearRect(0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
                
                // 高品質描画設定
                this.sourceCtx.imageSmoothingEnabled = true;
                this.sourceCtx.imageSmoothingQuality = 'high';
                
                this.sourceCtx.drawImage(this.cameraVideo, 0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
                
                // デバッグ用：カメラ映像が描画されているか確認
                if (this.frameCount % 60 === 0) {
                    console.log('Camera frame drawn:', this.cameraVideo.videoWidth, 'x', this.cameraVideo.videoHeight);
                }
            } catch (error) {
                console.error('Camera frame drawing error:', error);
                return;
            }
        } else if (this.isVideo && this.video && !this.video.paused && !this.video.ended) {
            try {
                // 動画をキャンバスサイズに合わせて描画
                this.sourceCtx.clearRect(0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
                this.sourceCtx.drawImage(this.video, 0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
            } catch (error) {
                console.error('Video frame drawing error:', error);
                // エラーが発生した場合、動画の状態をリセット
                if (this.video.readyState === 0) {
                    console.log('Video not ready, retrying...');
                    setTimeout(() => this.processFrame(), 100);
                }
                return;
            }
        } else if (this.isVideo && this.video && (this.video.paused || this.video.ended)) {
            // 動画が一時停止または終了した場合、再開を試行
            if (this.video.ended) {
                this.video.currentTime = 0;
            }
            this.video.play().catch(error => {
                console.error('Failed to restart video:', error);
            });
        }

        // エフェクトを適用
        const intensity = parseInt(document.getElementById('intensity').value);
        const direction = document.getElementById('direction').value;
        const stretchType = document.getElementById('stretchType').value;
        const stretchAmount = parseInt(document.getElementById('stretchAmount').value);
        const effectType = document.getElementById('effectType').value;

        console.log('Effect parameters:', { intensity, direction, stretchType, stretchAmount, effectType });
        console.log('WebGL status:', { useWebGL: this.useWebGL, gl: !!this.gl, program: !!this.program });

        // WebGLが利用可能な場合はGPUレンダリングを使用
        if (this.useWebGL && this.gl && this.program) {
            console.log('Using WebGL rendering');
            this.renderWithWebGL(intensity, direction, stretchType, stretchAmount, effectType);
        } else {
            // フォールバック: 2Dキャンバスレンダリング
            console.log('Using 2D canvas rendering');
            this.renderWith2DCanvas(intensity, direction, stretchType, stretchAmount, effectType);
        }

        // パフォーマンス監視
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastPerformanceCheck >= 1000) {
            const fps = this.frameCount / ((now - this.lastPerformanceCheck) / 1000);
            this.fpsHistory.push(fps);
            if (this.fpsHistory.length > 10) this.fpsHistory.shift();
            
            const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
            const memoryUsage = performance.memory ? 
                `Memory: ${Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)}MB / ${Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)}MB` : 
                'Memory: N/A';
            
            const renderer = this.useWebGL ? 'WebGL (GPU)' : '2D Canvas (CPU)';
            console.log(`Performance: FPS: ${avgFps.toFixed(1)}, Renderer: ${renderer}, Workers: ${this.useWorkers} (${this.activeWorkers}/${this.workerCount}), ${memoryUsage}`);
            
            // パフォーマンス警告
            if (avgFps < 30) {
                console.warn('Low FPS detected. Consider reducing resolution or effect intensity.');
            }
            
            this.frameCount = 0;
            this.lastPerformanceCheck = now;
        }
    }
    
    renderWithWebGL(intensity, direction, stretchType, stretchAmount, effectType) {
        try {
            // WebGLレンダリング
            this.gl.viewport(0, 0, this.outputCanvas.width, this.outputCanvas.height);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            
            // シェーダープログラムを使用
            this.gl.useProgram(this.program);
            
            // テクスチャにソース画像をアップロード
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
            this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.sourceCanvas);
            
            // ユニフォーム変数を設定
            if (this.resolutionLocation) {
                this.gl.uniform2f(this.resolutionLocation, this.outputCanvas.width, this.outputCanvas.height);
            }
            if (this.intensityLocation) {
                this.gl.uniform1f(this.intensityLocation, intensity / 100.0);
            }
            if (this.timeLocation) {
                this.gl.uniform1f(this.timeLocation, performance.now() * 0.001);
            }
            
            // 頂点属性を設定
            if (this.positionLocation !== -1) {
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.positionBuffer);
                this.gl.enableVertexAttribArray(this.positionLocation);
                this.gl.vertexAttribPointer(this.positionLocation, 2, this.gl.FLOAT, false, 0, 0);
            }
            
            if (this.texCoordLocation !== -1) {
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.texCoordBuffer);
                this.gl.enableVertexAttribArray(this.texCoordLocation);
                this.gl.vertexAttribPointer(this.texCoordLocation, 2, this.gl.FLOAT, false, 0, 0);
            }
            
            // 描画
            this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
            
            console.log('WebGL rendering successful');
        } catch (error) {
            console.error('WebGL rendering failed, falling back to 2D canvas:', error);
            this.useWebGL = false;
            this.renderWith2DCanvas(intensity, direction, stretchType, stretchAmount, effectType);
        }
    }
    
    renderWith2DCanvas(intensity, direction, stretchType, stretchAmount, effectType) {
        try {
            console.log('renderWith2DCanvas called with:', { intensity, direction, stretchType, stretchAmount, effectType });
            this.outputCtx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);

            if (effectType === 'slit-scan') {
                console.log('Applying slit-scan effect');
                this.applySlitScanEffect(intensity, direction, stretchType, stretchAmount);
            } else if (effectType === 'pixel-sort') {
                console.log('Applying pixel-sort effect');
                this.applyPixelSortEffect(intensity, direction);
            } else if (effectType === 'glitch') {
                console.log('Applying glitch effect');
                this.applyGlitchEffect(intensity);
            } else if (effectType === 'combined') {
                console.log('Applying combined effect');
                this.applyCombinedEffect(intensity, direction, stretchType, stretchAmount);
            } else {
                console.log('Unknown effect type:', effectType);
                this.outputCtx.drawImage(this.sourceCanvas, 0, 0);
            }
        } catch (error) {
            console.error('2D canvas rendering error:', error);
            this.outputCtx.drawImage(this.sourceCanvas, 0, 0);
        }
    }

    applySlitScanEffect(intensity, direction, stretchType, stretchAmount) {
        try {
                    console.log('applySlitScanEffect called with:', { intensity, direction, stretchType, stretchAmount });
        const imageData = this.sourceCtx.getImageData(0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
            const data = imageData.data;
            const width = imageData.width;
            const height = imageData.height;
            
            const outputData = new Uint8ClampedArray(data);
            const centerX = width / 2;
            const centerY = height / 2;
        
        // 引き伸ばし量の計算（0-200の範囲を0-1の範囲に正規化、非線形マッピング）
        const normalizedStretchAmount = Math.pow(stretchAmount / 200, 1.5); // 0-200 → 0-1（非線形）
        console.log('Normalized stretch amount:', normalizedStretchAmount);
        
        const getStretchFactor = (x, y) => {
            switch (stretchType) {
                case 'uniform':
                    return normalizedStretchAmount;
                case 'gradient':
                    return normalizedStretchAmount * (x / width + y / height) / 2;
                case 'random':
                    return normalizedStretchAmount * (0.5 + Math.random() * 0.5);
                case 'center':
                    const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
                    const maxDistance = Math.sqrt(centerX ** 2 + centerY ** 2);
                    return normalizedStretchAmount * (1 - distance / maxDistance);
                case 'edges':
                    const edgeDistance = Math.min(x, y, width - x, height - y);
                    const maxEdgeDistance = Math.min(centerX, centerY);
                    return normalizedStretchAmount * (edgeDistance / maxEdgeDistance);
                default:
                    return normalizedStretchAmount;
            }
        };

        if (direction === 'vertical') {
            for (let x = 0; x < width; x += Math.max(1, Math.floor(10 * intensity))) {
                const stretchFactor = getStretchFactor(x, 0);
                const waveOffset = Math.sin(x * 0.01 + this.currentFrame * 0.05) * intensity * 50;
                
                for (let y = 0; y < height; y++) {
                    const stretchedY = y * (1 + stretchFactor);
                    const sourceY = Math.max(0, Math.min(height - 1, stretchedY + waveOffset));
                    const sourceIndex = (Math.floor(sourceY) * width + x) * 4;
                    const targetIndex = (y * width + x) * 4;
                    
                    outputData[targetIndex] = data[sourceIndex];
                    outputData[targetIndex + 1] = data[sourceIndex + 1];
                    outputData[targetIndex + 2] = data[sourceIndex + 2];
                    outputData[targetIndex + 3] = data[sourceIndex + 3];
                }
            }
        } else if (direction === 'horizontal') {
            for (let y = 0; y < height; y++) {
                const stretchFactor = getStretchFactor(0, y);
                const waveOffset = Math.sin(y * 0.01 + this.currentFrame * 0.05) * intensity * 50;
                
                for (let x = 0; x < width; x++) {
                    const stretchedX = x * (1 + stretchFactor);
                    const sourceX = Math.max(0, Math.min(width - 1, stretchedX + waveOffset));
                    const sourceIndex = (y * width + Math.floor(sourceX)) * 4;
                    const targetIndex = (y * width + x) * 4;
                    
                    outputData[targetIndex] = data[sourceIndex];
                    outputData[targetIndex + 1] = data[sourceIndex + 1];
                    outputData[targetIndex + 2] = data[sourceIndex + 2];
                    outputData[targetIndex + 3] = data[sourceIndex + 3];
                }
            }
        } else if (direction === 'radial') {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const dx = x - centerX;
                    const dy = y - centerY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const angle = Math.atan2(dy, dx);
                    
                    const stretchFactor = getStretchFactor(x, y);
                    const stretchedDistance = distance * (1 + stretchFactor);
                    
                    const sourceX = centerX + Math.cos(angle) * stretchedDistance;
                    const sourceY = centerY + Math.sin(angle) * stretchedDistance;
                    
                    const clampedX = Math.max(0, Math.min(width - 1, Math.floor(sourceX)));
                    const clampedY = Math.max(0, Math.min(height - 1, Math.floor(sourceY)));
                    
                    const sourceIndex = (clampedY * width + clampedX) * 4;
                    const targetIndex = (y * width + x) * 4;
                    
                    outputData[targetIndex] = data[sourceIndex];
                    outputData[targetIndex + 1] = data[sourceIndex + 1];
                    outputData[targetIndex + 2] = data[sourceIndex + 2];
                    outputData[targetIndex + 3] = data[sourceIndex + 3];
                }
            }
        } else if (direction === 'wave') {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const stretchFactor = getStretchFactor(x, y);
                    const waveX = Math.sin(y * 0.02 + this.currentFrame * 0.03) * intensity * 30;
                    const waveY = Math.cos(x * 0.02 + this.currentFrame * 0.04) * intensity * 30;
                    
                    const sourceX = x + waveX;
                    const sourceY = y * (1 + stretchFactor) + waveY;
                    
                    const clampedX = Math.max(0, Math.min(width - 1, Math.floor(sourceX)));
                    const clampedY = Math.max(0, Math.min(height - 1, Math.floor(sourceY)));
                    
                    const sourceIndex = (clampedY * width + clampedX) * 4;
                    const targetIndex = (y * width + x) * 4;
                    
                    outputData[targetIndex] = data[sourceIndex];
                    outputData[targetIndex + 1] = data[sourceIndex + 1];
                    outputData[targetIndex + 2] = data[sourceIndex + 2];
                    outputData[targetIndex + 3] = data[sourceIndex + 3];
                }
            }
        } else if (direction === 'spiral') {
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const dx = x - centerX;
                    const dy = y - centerY;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const angle = Math.atan2(dy, dx);
                    
                    const stretchFactor = getStretchFactor(x, y);
                    const spiralAngle = angle + distance * 0.01 * intensity;
                    const stretchedDistance = distance * (1 + stretchFactor);
                    
                    const sourceX = centerX + Math.cos(spiralAngle) * stretchedDistance;
                    const sourceY = centerY + Math.sin(spiralAngle) * stretchedDistance;
                    
                    const clampedX = Math.max(0, Math.min(width - 1, Math.floor(sourceX)));
                    const clampedY = Math.max(0, Math.min(height - 1, Math.floor(sourceY)));
                    
                    const sourceIndex = (clampedY * width + clampedX) * 4;
                    const targetIndex = (y * width + x) * 4;
                    
                    outputData[targetIndex] = data[sourceIndex];
                    outputData[targetIndex + 1] = data[sourceIndex + 1];
                    outputData[targetIndex + 2] = data[sourceIndex + 2];
                    outputData[targetIndex + 3] = data[sourceIndex + 3];
                }
            }
        }

        const newImageData = new ImageData(outputData, width, height);
        this.outputCtx.putImageData(newImageData, 0, 0);
        
        this.currentFrame++;
        console.log('applySlitScanEffect completed successfully');
    } catch (error) {
        console.error('Slit scan effect error:', error);
        // エラーが発生した場合は、ソース画像をそのまま表示
        this.outputCtx.drawImage(this.sourceCanvas, 0, 0);
    }
}

applyPixelSortEffect(intensity, direction) {
    try {
            const imageData = this.sourceCtx.getImageData(0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
            const data = imageData.data;
            const width = imageData.width;
            const height = imageData.height;
            
            const outputData = new Uint8ClampedArray(data);
            const centerX = width / 2;
            const centerY = height / 2;
            
            if (direction === 'vertical') {
                for (let x = 0; x < width; x += Math.max(1, Math.floor(10 * intensity))) {
                    const column = [];
                    for (let y = 0; y < height; y++) {
                        const index = (y * width + x) * 4;
                        column.push({
                            r: data[index],
                            g: data[index + 1],
                            b: data[index + 2],
                            a: data[index + 3]
                        });
                    }
                    
                    // 複数のソート方法
                    const sortMethod = Math.floor(this.currentFrame / 30) % 4;
                    switch (sortMethod) {
                        case 0: // 明度でソート
                            column.sort((a, b) => {
                                const brightnessA = (a.r + a.g + a.b) / 3;
                                const brightnessB = (b.r + b.g + b.b) / 3;
                                return brightnessA - brightnessB;
                            });
                            break;
                        case 1: // 色相でソート
                            column.sort((a, b) => {
                                const hueA = this.getHue(a.r, a.g, a.b);
                                const hueB = this.getHue(b.r, b.g, b.b);
                                return hueA - hueB;
                            });
                            break;
                        case 2: // 彩度でソート
                            column.sort((a, b) => {
                                const satA = this.getSaturation(a.r, a.g, a.b);
                                const satB = this.getSaturation(b.r, b.g, b.b);
                                return satA - satB;
                            });
                            break;
                        case 3: // ランダムソート
                            for (let i = column.length - 1; i > 0; i--) {
                                const j = Math.floor(Math.random() * (i + 1));
                                [column[i], column[j]] = [column[j], column[i]];
                            }
                            break;
                    }
                    
                    for (let y = 0; y < height; y++) {
                        const index = (y * width + x) * 4;
                        outputData[index] = column[y].r;
                        outputData[index + 1] = column[y].g;
                        outputData[index + 2] = column[y].b;
                        outputData[index + 3] = column[y].a;
                    }
                }
            } else if (direction === 'horizontal') {
                for (let y = 0; y < height; y += Math.max(1, Math.floor(10 * intensity))) {
                    const row = [];
                    for (let x = 0; x < width; x++) {
                        const index = (y * width + x) * 4;
                        row.push({
                            r: data[index],
                            g: data[index + 1],
                            b: data[index + 2],
                            a: data[index + 3]
                        });
                    }
                    
                    // 明度でソート
                    row.sort((a, b) => {
                        const brightnessA = (a.r + a.g + a.b) / 3;
                        const brightnessB = (b.r + b.g + b.b) / 3;
                        return brightnessA - brightnessB;
                    });
                    
                    for (let x = 0; x < width; x++) {
                        const index = (y * width + x) * 4;
                        outputData[index] = row[x].r;
                        outputData[index + 1] = row[x].g;
                        outputData[index + 2] = row[x].b;
                        outputData[index + 3] = row[x].a;
                    }
                }
            } else if (direction === 'radial') {
                // 放射状のピクセルソート
                for (let angle = 0; angle < 360; angle += 5) {
                    const rad = angle * Math.PI / 180;
                    const pixels = [];
                    
                    for (let r = 0; r < Math.max(width, height); r++) {
                        const x = centerX + Math.cos(rad) * r;
                        const y = centerY + Math.sin(rad) * r;
                        
                        if (x >= 0 && x < width && y >= 0 && y < height) {
                            const index = (Math.floor(y) * width + Math.floor(x)) * 4;
                            pixels.push({
                                r: data[index],
                                g: data[index + 1],
                                b: data[index + 2],
                                a: data[index + 3],
                                x: Math.floor(x),
                                y: Math.floor(y)
                            });
                        }
                    }
                    
                    // 明度でソート
                    pixels.sort((a, b) => {
                        const brightnessA = (a.r + a.g + a.b) / 3;
                        const brightnessB = (b.r + b.g + b.b) / 3;
                        return brightnessA - brightnessB;
                    });
                    
                    // ソートされたピクセルを配置
                    for (let i = 0; i < pixels.length; i++) {
                        const pixel = pixels[i];
                        const index = (pixel.y * width + pixel.x) * 4;
                        outputData[index] = pixel.r;
                        outputData[index + 1] = pixel.g;
                        outputData[index + 2] = pixel.b;
                        outputData[index + 3] = pixel.a;
                    }
                }
            }

            const newImageData = new ImageData(outputData, width, height);
            this.outputCtx.putImageData(newImageData, 0, 0);
        } catch (error) {
            console.error('Pixel sort effect error:', error);
            // エラーが発生した場合は、ソース画像をそのまま表示
            this.outputCtx.drawImage(this.sourceCanvas, 0, 0);
        }
    }

    getHue(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        
        if (delta === 0) return 0;
        
        let hue;
        if (max === r) {
            hue = ((g - b) / delta) % 6;
        } else if (max === g) {
            hue = (b - r) / delta + 2;
        } else {
            hue = (r - g) / delta + 4;
        }
        
        return hue * 60;
    }

    getSaturation(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const delta = max - min;
        
        if (max === 0) return 0;
        return delta / max;
    }

    applyGlitchEffect(intensity) {
        try {
            const imageData = this.sourceCtx.getImageData(0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
            const data = imageData.data;
            const width = imageData.width;
            const height = imageData.height;
            
            const outputData = new Uint8ClampedArray(data);
        
        // ランダムなグリッチブロック
        const numGlitches = Math.floor(intensity * 20);
        for (let i = 0; i < numGlitches; i++) {
            const x = Math.floor(Math.random() * width);
            const y = Math.floor(Math.random() * height);
            const blockWidth = Math.floor(Math.random() * 50) + 10;
            const blockHeight = Math.floor(Math.random() * 20) + 5;
            
            // 黒いブロック
            for (let dx = 0; dx < blockWidth; dx++) {
                for (let dy = 0; dy < blockHeight; dy++) {
                    const targetX = x + dx;
                    const targetY = y + dy;
                    if (targetX < width && targetY < height) {
                        const index = (targetY * width + targetX) * 4;
                        outputData[index] = 0;
                        outputData[index + 1] = 0;
                        outputData[index + 2] = 0;
                        outputData[index + 3] = 255;
                    }
                }
            }
        }
        
        // 白い線
        for (let i = 0; i < numGlitches / 2; i++) {
            const y = Math.floor(Math.random() * height);
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                outputData[index] = 255;
                outputData[index + 1] = 255;
                outputData[index + 2] = 255;
                outputData[index + 3] = 255;
            }
        }

        const newImageData = new ImageData(outputData, width, height);
        this.outputCtx.putImageData(newImageData, 0, 0);
    } catch (error) {
        console.error('Glitch effect error:', error);
        // エラーが発生した場合は、ソース画像をそのまま表示
        this.outputCtx.drawImage(this.sourceCanvas, 0, 0);
    }
}

applyCombinedEffect(intensity, direction, stretchType, stretchAmount) {
    try {
            this.applySlitScanEffect(intensity * 0.7, direction, stretchType, stretchAmount);
            this.applyPixelSortEffect(intensity * 0.5, direction);
            this.applyGlitchEffect(intensity * 0.3);
        } catch (error) {
            console.error('Combined effect error:', error);
            // エラーが発生した場合は、ソース画像をそのまま表示
            this.outputCtx.drawImage(this.sourceCanvas, 0, 0);
        }
    }

    resetCanvas() {
        if (this.isVideo && this.video) {
            this.video.pause();
            this.video.currentTime = 0;
        }
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        // 自動アニメーションを停止
        this.stopAutoAnimation();
        
        this.currentFrame = 0;
        this.autoTime = 0;
        
        // キャンバスをクリア
        this.outputCtx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);
        
        // 元の画像を再描画
        if (!this.isVideo) {
            this.sourceCtx.drawImage(this.sourceCanvas, 0, 0);
            this.outputCtx.drawImage(this.sourceCanvas, 0, 0);
        }
        
        console.log('Canvas reset');
    }

    startAutoAnimation() {
        if (this.autoAnimationId) {
            cancelAnimationFrame(this.autoAnimationId);
        }
        
        console.log('Starting auto animation');
        this.autoTime = 0;
        
        const animate = () => {
            if (!this.autoMode) return;
            
            // フレーム制限（60FPS制限で高パフォーマンス）
            if (this.lastAutoFrameTime && performance.now() - this.lastAutoFrameTime < 16.67) {
                this.autoAnimationId = requestAnimationFrame(animate);
                return;
            }
            this.lastAutoFrameTime = performance.now();
            
            // 自動速度を取得
            const autoSpeed = parseInt(document.getElementById('autoSpeed').value) / 100;
            
            // 時間に基づいてパラメータを更新
            this.autoTime += 0.016; // 約60FPS
            
            // 個別のオート設定をチェックしてパラメータを更新
            if (document.getElementById('autoIntensity').checked) {
                // 強度を正弦波で変化させる
                const intensity = Math.abs(Math.sin(this.autoTime * autoSpeed * 2)) * 0.8 + 0.2;
                document.getElementById('intensity').value = Math.round(intensity * 100);
                document.getElementById('intensityValue').textContent = Math.round(intensity * 100);
            }
            
            if (document.getElementById('autoStretch').checked) {
                // ストレッチ量を正弦波でスムーズに変化させる（0-200の範囲）
                const normalizedStretch = (Math.sin(this.autoTime * autoSpeed * 1.5) + 1) / 2; // 0-1の範囲
                const stretchAmount = Math.round(normalizedStretch * 200);
                
                // 前の値との差分を制限して急激な変化を防ぐ
                const currentValue = parseInt(document.getElementById('stretchAmount').value);
                const maxChange = 3; // 1フレームあたりの最大変化量（通常モードは少し遅く）
                const diff = stretchAmount - currentValue;
                const limitedDiff = Math.max(-maxChange, Math.min(maxChange, diff));
                const newValue = currentValue + limitedDiff;
                
                document.getElementById('stretchAmount').value = newValue;
                document.getElementById('stretchAmountValue').textContent = newValue;
            }
            
            // エフェクトを適用
            this.processFrame();
            
            this.autoAnimationId = requestAnimationFrame(animate);
        };
        
        animate();
    }

    stopAutoAnimation() {
        if (this.autoAnimationId) {
            cancelAnimationFrame(this.autoAnimationId);
            this.autoAnimationId = null;
            console.log('Auto animation stopped');
        }
    }

    startAutoAnimationForRecording() {
        if (this.recordingAnimationId) {
            cancelAnimationFrame(this.recordingAnimationId);
        }
        
        console.log('Starting auto animation for recording');
        this.recordingTime = 0;
        
        const animate = () => {
            if (!this.isRecording) return;
            
            // フレーム制限（60FPS制限で高パフォーマンス）
            if (this.lastRecordingFrameTime && performance.now() - this.lastRecordingFrameTime < 16.67) {
                this.recordingAnimationId = requestAnimationFrame(animate);
                return;
            }
            this.lastRecordingFrameTime = performance.now();
            
            // 自動速度を取得
            const autoSpeed = parseInt(document.getElementById('autoSpeed').value) / 100;
            
            // 時間に基づいてパラメータを更新
            this.recordingTime += 0.016; // 約60FPS
            
            // 個別のオート設定をチェックしてパラメータを更新
            if (document.getElementById('autoIntensity').checked) {
                // 強度を正弦波で変化させる
                const intensity = Math.abs(Math.sin(this.recordingTime * autoSpeed * 2)) * 0.8 + 0.2;
                document.getElementById('intensity').value = Math.round(intensity * 100);
                document.getElementById('intensityValue').textContent = Math.round(intensity * 100);
            }
            
            if (document.getElementById('autoStretch').checked) {
                // ストレッチ量を正弦波でスムーズに変化させる（0-200の範囲）
                const normalizedStretch = (Math.sin(this.recordingTime * autoSpeed * 1.5) + 1) / 2; // 0-1の範囲
                const stretchAmount = Math.round(normalizedStretch * 200);
                
                // 前の値との差分を制限して急激な変化を防ぐ
                const currentValue = parseInt(document.getElementById('stretchAmount').value);
                const maxChange = 5; // 1フレームあたりの最大変化量
                const diff = stretchAmount - currentValue;
                const limitedDiff = Math.max(-maxChange, Math.min(maxChange, diff));
                const newValue = currentValue + limitedDiff;
                
                document.getElementById('stretchAmount').value = newValue;
                document.getElementById('stretchAmountValue').textContent = newValue;
                
                // デバッグログ（録画中のみ）
                if (this.isRecording && this.recordedFrames.length % 30 === 0) { // 30フレームごとにログ
                    console.log(`Recording frame ${this.recordedFrames.length}: stretchAmount = ${newValue}`);
                }
            }
            
            // エフェクトを適用
            this.processFrame();
            
            this.recordingAnimationId = requestAnimationFrame(animate);
        };
        
        animate();
    }

    stopAutoAnimationForRecording() {
        if (this.recordingAnimationId) {
            cancelAnimationFrame(this.recordingAnimationId);
            this.recordingAnimationId = null;
            console.log('Recording auto animation stopped');
        }
    }

    downloadResult() {
        const link = document.createElement('a');
        link.download = 'slit-scan-effect.png';
        link.href = this.outputCanvas.toDataURL();
        link.click();
    }

    openPopupWindow() {
        // ポップアップウィンドウの設定
        const popupFeatures = [
            'width=800',
            'height=600',
            'resizable=yes',
            'scrollbars=no',
            'toolbar=no',
            'menubar=no',
            'location=no',
            'status=no',
            'directories=no',
            'copyhistory=no',
            'left=100',
            'top=100'
        ].join(',');

        // ポップアップウィンドウを開く
        const popup = window.open('popup.html', 'canvasPopup', popupFeatures);
        
        if (popup) {
            this.popupWindow = popup;
            
            // Windowsでの互換性のため、複数の方法でイベントを設定
            const setupPopup = () => {
                try {
                    console.log('Popup window loaded');
                    
                    // ポップアップウィンドウにメインウィンドウの参照を渡す
                    popup.slitScanEffect = this;
                    
                    // 定期的にポップアップウィンドウを更新
                    this.startPopupUpdate();
                    
                    // ポップアップウィンドウが閉じられた時の処理
                    const checkClosed = setInterval(() => {
                        if (popup.closed) {
                            console.log('Popup window closed');
                            this.stopPopupUpdate();
                            this.popupWindow = null;
                            clearInterval(checkClosed);
                        }
                    }, 1000);
                    
                } catch (error) {
                    console.warn('Popup setup error:', error);
                    // エラーが発生した場合は再試行
                    setTimeout(setupPopup, 100);
                }
            };
            
            // 複数の方法でロードイベントを監視
            if (popup.document.readyState === 'complete') {
                setupPopup();
            } else {
                popup.addEventListener('load', setupPopup);
                popup.addEventListener('DOMContentLoaded', setupPopup);
                
                // フォールバック: タイムアウトで強制実行
                setTimeout(setupPopup, 2000);
            }
            
        } else {
            alert('ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。');
        }
    }

    startPopupUpdate() {
        if (this.popupUpdateInterval) {
            clearInterval(this.popupUpdateInterval);
        }
        
        // フルスクリーン時はより高頻度で更新
        const updateInterval = this.popupWindow && this.popupWindow.isFullscreen ? 1000 / 60 : 1000 / 30;
        
        this.popupUpdateInterval = setInterval(() => {
            try {
                if (this.popupWindow && !this.popupWindow.closed) {
                    // ポップアップウィンドウにメッセージを送信
                    this.popupWindow.postMessage({
                        type: 'updateCanvas'
                    }, '*');
                    
                    // 直接的な更新も試行（Windowsでの互換性のため）
                    if (this.popupWindow.slitScanEffect && this.outputCanvas) {
                        try {
                            const popupCanvas = this.popupWindow.document.getElementById('popupCanvas');
                            if (popupCanvas) {
                                const popupCtx = popupCanvas.getContext('2d');
                                if (popupCtx) {
                                    // 高品質描画設定
                                    popupCtx.imageSmoothingEnabled = true;
                                    popupCtx.imageSmoothingQuality = 'high';
                                    
                                    popupCtx.clearRect(0, 0, popupCanvas.width, popupCanvas.height);
                                    popupCtx.drawImage(this.outputCanvas, 0, 0, popupCanvas.width, popupCanvas.height);
                                }
                            }
                        } catch (error) {
                            // 直接更新でエラーが発生した場合は無視
                        }
                    }
                } else {
                    this.stopPopupUpdate();
                }
            } catch (error) {
                console.warn('Popup update error:', error);
                this.stopPopupUpdate();
            }
        }, updateInterval);
    }

    stopPopupUpdate() {
        if (this.popupUpdateInterval) {
            clearInterval(this.popupUpdateInterval);
            this.popupUpdateInterval = null;
        }
    }

    // Webカメラ機能
    async startCamera() {
        // カメラ選択ダイアログを表示
        await this.showCameraSelectionDialog();
    }

    stopCamera() {
        if (this.cameraStream) {
            // カメラストリームを停止
            this.cameraStream.getTracks().forEach(track => track.stop());
            this.cameraStream = null;
        }

        if (this.cameraVideo) {
            this.cameraVideo.pause();
            this.cameraVideo.srcObject = null;
            this.cameraVideo = null;
        }

        // アニメーションを停止
        if (this.cameraAnimationId) {
            cancelAnimationFrame(this.cameraAnimationId);
            this.cameraAnimationId = null;
        }

        this.isCameraActive = false;
        this.isVideo = false;

        // ボタンの状態を更新
        const cameraBtn = document.getElementById('cameraBtn');
        if (cameraBtn) {
            cameraBtn.textContent = '📹 Camera';
            cameraBtn.classList.remove('active');
        }

        console.log('Camera stopped');
    }

    startCameraAnimation() {
        // カメラアニメーション開始
        this.animate();
    }

    // 利用可能なカメラデバイスを取得
    async getAvailableCameras() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            console.log('Available cameras:', videoDevices);
            return videoDevices;
        } catch (error) {
            console.error('Error getting camera devices:', error);
            return [];
        }
    }

    // 特定のカメラデバイスでカメラを開始
    async startCameraWithDevice(deviceId = null) {
        try {
            // 既存のカメラを停止
            if (this.isCameraActive) {
                this.stopCamera();
            }

            // カメラストリームを取得
            const constraints = {
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'user'
                },
                audio: false
            };

            // 特定のデバイスが指定されている場合
            if (deviceId) {
                constraints.video.deviceId = { exact: deviceId };
            }

            this.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);

            // カメラ用のvideo要素を作成
            this.cameraVideo = document.createElement('video');
            this.cameraVideo.srcObject = this.cameraStream;
            this.cameraVideo.autoplay = true;
            this.cameraVideo.muted = true;
            this.cameraVideo.playsInline = true;
            this.cameraVideo.crossOrigin = 'anonymous';

            // カメラが読み込まれたら処理開始
            this.cameraVideo.addEventListener('loadedmetadata', () => {
                console.log('Camera loaded:', this.cameraVideo.videoWidth, 'x', this.cameraVideo.videoHeight);
                
                // キャンバスサイズを設定
                this.setupCanvas(this.cameraVideo.videoWidth, this.cameraVideo.videoHeight);
                
                // カメラアニメーション開始
                this.startCameraAnimation();
                
                this.isCameraActive = true;
                this.isVideo = true;
                
                // ボタンの状態を更新
                const cameraBtn = document.getElementById('cameraBtn');
                if (cameraBtn) {
                    cameraBtn.textContent = '📹 Stop Camera';
                    cameraBtn.classList.add('active');
                }
                
                // カメラの再生を確実に開始
                this.cameraVideo.play().catch(error => {
                    console.error('Failed to play camera video:', error);
                });
            });

            // カメラの再生開始を待つ
            this.cameraVideo.addEventListener('playing', () => {
                console.log('Camera started playing');
            });

            // エラーハンドリング
            this.cameraVideo.addEventListener('error', (error) => {
                console.error('Camera video error:', error);
            });

        } catch (error) {
            console.error('Camera access error:', error);
            alert('カメラへのアクセスに失敗しました。ブラウザの設定でカメラを許可してください。');
        }
    }

    // カメラ選択ダイアログを表示
    async showCameraSelectionDialog() {
        try {
            // 利用可能なカメラを取得
            const cameras = await this.getAvailableCameras();
            
            if (cameras.length === 0) {
                // カメラが見つからない場合はデフォルトカメラを試行
                await this.startCameraWithDevice();
                return;
            }

            // カメラ選択ダイアログを作成
            const dialog = document.createElement('div');
            dialog.className = 'camera-dialog';
            dialog.innerHTML = `
                <div class="camera-dialog-content">
                    <h3>カメラを選択</h3>
                    <div class="camera-list">
                        ${cameras.map((camera, index) => `
                            <div class="camera-item" data-device-id="${camera.deviceId}">
                                <div class="camera-icon">📹</div>
                                <div class="camera-info">
                                    <div class="camera-name">${camera.label || `カメラ ${index + 1}`}</div>
                                    <div class="camera-id">${camera.deviceId.substring(0, 20)}...</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="camera-dialog-buttons">
                        <button class="btn btn-secondary" id="cancelCameraBtn">キャンセル</button>
                    </div>
                </div>
            `;

            // ダイアログを表示
            document.body.appendChild(dialog);

            // カメラ選択イベント
            const cameraItems = dialog.querySelectorAll('.camera-item');
            cameraItems.forEach(item => {
                item.addEventListener('click', async () => {
                    const deviceId = item.dataset.deviceId;
                    dialog.remove();
                    await this.startCameraWithDevice(deviceId);
                });
            });

            // キャンセルボタン
            dialog.querySelector('#cancelCameraBtn').addEventListener('click', () => {
                dialog.remove();
            });

        } catch (error) {
            console.error('Camera selection error:', error);
            // エラーの場合はデフォルトカメラを試行
            await this.startCameraWithDevice();
        }
    }

    toggleCamera() {
        if (this.isCameraActive) {
            this.stopCamera();
        } else {
            this.startCamera();
        }
    }

    // フルスクリーン機能
    toggleFullscreen() {
        const canvasContainer = document.querySelector('.canvas-container');
        
        if (!document.fullscreenElement && !document.webkitFullscreenElement && !document.msFullscreenElement) {
            // フルスクリーンに入る
            if (canvasContainer.requestFullscreen) {
                canvasContainer.requestFullscreen();
            } else if (canvasContainer.webkitRequestFullscreen) {
                canvasContainer.webkitRequestFullscreen();
            } else if (canvasContainer.msRequestFullscreen) {
                canvasContainer.msRequestFullscreen();
            }
        } else {
            // フルスクリーンを終了
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    }

    // フルスクリーン状態の変更を監視
    handleFullscreenChange() {
        const isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
        const fullscreenBtn = document.getElementById('fullscreenBtn');
        const canvasContainer = document.querySelector('.canvas-container');
        const fullscreenControls = document.getElementById('fullscreenControls');
        
        if (fullscreenBtn) {
            if (isFullscreen) {
                fullscreenBtn.textContent = '⛶';
                fullscreenBtn.classList.add('active');
                canvasContainer.classList.add('fullscreen');
                
                // フルスクリーン用コントロールUIを表示
                if (fullscreenControls) {
                    fullscreenControls.style.display = 'block';
                    this.syncFullscreenControls();
                }
                
                // フルスクリーン時にキャンバスサイズを調整
                this.adjustCanvasForFullscreen();
            } else {
                fullscreenBtn.textContent = '⛶';
                fullscreenBtn.classList.remove('active');
                canvasContainer.classList.remove('fullscreen');
                
                // フルスクリーン用コントロールUIを非表示
                if (fullscreenControls) {
                    fullscreenControls.style.display = 'none';
                }
                
                // フルスクリーン終了時にキャンバスサイズを元に戻す
                this.restoreCanvasSize();
            }
        }
    }

    // フルスクリーン時にキャンバスサイズを調整
    adjustCanvasForFullscreen() {
        const canvas = this.outputCanvas;
        const container = document.querySelector('.canvas-container.fullscreen');
        
        if (container && canvas) {
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;
            const aspectRatio = canvas.width / canvas.height;
            
            let newWidth, newHeight;
            
            if (aspectRatio > 1) {
                // 横長
                newWidth = containerWidth;
                newHeight = newWidth / aspectRatio;
                
                if (newHeight > containerHeight) {
                    newHeight = containerHeight;
                    newWidth = newHeight * aspectRatio;
                }
            } else {
                // 縦長
                newHeight = containerHeight;
                newWidth = newHeight * aspectRatio;
                
                if (newWidth > containerWidth) {
                    newWidth = containerWidth;
                    newHeight = newWidth / aspectRatio;
                }
            }
            
            canvas.style.width = newWidth + 'px';
            canvas.style.height = newHeight + 'px';
        }
    }

    // キャンバスサイズを元に戻す
    restoreCanvasSize() {
        const canvas = this.outputCanvas;
        if (canvas) {
            canvas.style.width = '';
            canvas.style.height = '';
        }
    }

    // フルスクリーン用コントロールUIのセットアップ
    setupFullscreenControls() {
        // フルスクリーン用コントロールの表示/非表示切り替え
        const closeFullscreenBtn = document.getElementById('closeFullscreenBtn');
        if (closeFullscreenBtn) {
            closeFullscreenBtn.addEventListener('click', () => {
                this.toggleFullscreen();
            });
        }

        // フルスクリーン用スライダーのイベントリスナー
        const fullscreenIntensity = document.getElementById('fullscreenIntensity');
        const fullscreenStretchAmount = document.getElementById('fullscreenStretchAmount');
        
        if (fullscreenIntensity) {
            fullscreenIntensity.addEventListener('input', (e) => {
                const value = e.target.value;
                document.getElementById('fullscreenIntensityValue').textContent = value;
                
                // メインのスライダーも同期
                const mainIntensity = document.getElementById('intensity');
                if (mainIntensity) {
                    mainIntensity.value = value;
                    document.getElementById('intensityValue').textContent = value;
                }
                
                // エフェクトを適用
                if (!this.isVideo || this.isCameraActive) {
                    this.processFrame();
                }
            });
        }

        if (fullscreenStretchAmount) {
            fullscreenStretchAmount.addEventListener('input', (e) => {
                const value = e.target.value;
                document.getElementById('fullscreenStretchAmountValue').textContent = value;
                
                // メインのスライダーも同期
                const mainStretchAmount = document.getElementById('stretchAmount');
                if (mainStretchAmount) {
                    mainStretchAmount.value = value;
                    document.getElementById('stretchAmountValue').textContent = value;
                }
                
                // エフェクトを適用
                if (!this.isVideo || this.isCameraActive) {
                    this.processFrame();
                }
            });
        }

        // フルスクリーン用セレクトボックスのイベントリスナー
        const fullscreenEffectType = document.getElementById('fullscreenEffectType');
        const fullscreenDirection = document.getElementById('fullscreenDirection');
        const fullscreenStretchType = document.getElementById('fullscreenStretchType');
        
        [fullscreenEffectType, fullscreenDirection, fullscreenStretchType].forEach(select => {
            if (select) {
                select.addEventListener('change', (e) => {
                    const value = e.target.value;
                    const mainSelect = document.getElementById(e.target.id.replace('fullscreen', '').toLowerCase());
                    
                    // メインのセレクトボックスも同期
                    if (mainSelect) {
                        mainSelect.value = value;
                    }
                    
                    // エフェクトを適用
                    if (!this.isVideo || this.isCameraActive) {
                        this.processFrame();
                    }
                });
            }
        });
    }

    // フルスクリーン用コントロールの値を同期
    syncFullscreenControls() {
        const fullscreenIntensity = document.getElementById('fullscreenIntensity');
        const fullscreenStretchAmount = document.getElementById('fullscreenStretchAmount');
        const fullscreenEffectType = document.getElementById('fullscreenEffectType');
        const fullscreenDirection = document.getElementById('fullscreenDirection');
        const fullscreenStretchType = document.getElementById('fullscreenStretchType');
        
        // メインのコントロールから値を取得して同期
        const mainIntensity = document.getElementById('intensity');
        const mainStretchAmount = document.getElementById('stretchAmount');
        const mainEffectType = document.getElementById('effectType');
        const mainDirection = document.getElementById('direction');
        const mainStretchType = document.getElementById('stretchType');
        
        if (fullscreenIntensity && mainIntensity) {
            fullscreenIntensity.value = mainIntensity.value;
            document.getElementById('fullscreenIntensityValue').textContent = mainIntensity.value;
        }
        
        if (fullscreenStretchAmount && mainStretchAmount) {
            fullscreenStretchAmount.value = mainStretchAmount.value;
            document.getElementById('fullscreenStretchAmountValue').textContent = mainStretchAmount.value;
        }
        
        if (fullscreenEffectType && mainEffectType) {
            fullscreenEffectType.value = mainEffectType.value;
        }
        
        if (fullscreenDirection && mainDirection) {
            fullscreenDirection.value = mainDirection.value;
        }
        
        if (fullscreenStretchType && mainStretchType) {
            fullscreenStretchType.value = mainStretchType.value;
        }
    }

    downloadVideo() {
        // MediaRecorder のサポートチェック
        if (!window.MediaRecorder) {
            alert('Video recording is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Edge.');
            return;
        }

        // 動画または静止画の録画を開始
        if (this.isVideo && this.video) {
            // 動画ファイルの場合
            this.startVideoRecording();
        } else {
            // 静止画の場合
            this.startImageRecording();
        }
    }

    startImageRecording() {
        if (this.isRecording) {
            console.log('Already recording');
            return;
        }

        this.isRecording = true;
        this.recordedFrames = [];
        this.recordingStartTime = performance.now();
        
        // 録画ステータスを表示
        document.getElementById('recordingStatus').style.display = 'flex';
        document.getElementById('downloadBtn').disabled = true;
        document.getElementById('downloadBtn').textContent = 'Recording...';
        
        // 録画時間を設定（ユーザーが選択した時間）
        const recordingDuration = parseInt(document.getElementById('recordingDuration').value); // 秒
        const targetFPS = 30; // 30FPS for smooth playback
        const frameInterval = 1000 / targetFPS; // ミリ秒
        
        console.log(`Starting simple screen recording: ${recordingDuration}s at ${targetFPS}FPS`);
        
        // 録画ループを開始
        const recordFrame = () => {
            if (!this.isRecording) return;
            
            const currentTime = performance.now();
            const elapsedTime = (currentTime - this.recordingStartTime) / 1000;
            
            if (elapsedTime >= recordingDuration) {
                this.stopVideoRecording();
                return;
            }
            
            // フレームレート制限（30FPS）
            if (this.lastRecordFrameTime && currentTime - this.lastRecordFrameTime < frameInterval) {
                requestAnimationFrame(recordFrame);
                return;
            }
            this.lastRecordFrameTime = currentTime;
            
            // 現在のキャンバスを画像として保存
            try {
                const frameDataURL = this.outputCanvas.toDataURL('image/png', 0.9);
                this.recordedFrames.push({
                    dataURL: frameDataURL,
                    timestamp: elapsedTime
                });
                
                // 録画進捗を更新
                const progress = (elapsedTime / recordingDuration) * 100;
                document.getElementById('recordingStatus').textContent = `Recording... ${progress.toFixed(1)}%`;
                
            } catch (error) {
                console.error('Frame capture error:', error);
            }
            
            // 次のフレームをスケジュール
            requestAnimationFrame(recordFrame);
        };
        
        // 録画開始
        recordFrame();
        
        // 静止画の場合、自動アニメーションを開始（録画中のみ）
        if (!this.isVideo && this.autoMode) {
            this.startAutoAnimationForRecording();
        }
    }

    startVideoRecording() {
        if (this.isRecording) {
            console.log('Already recording');
            return;
        }

        this.isRecording = true;
        this.recordedFrames = [];
        this.recordingStartTime = performance.now();
        
        // 録画ステータスを表示
        document.getElementById('recordingStatus').style.display = 'flex';
        document.getElementById('downloadBtn').disabled = true;
        document.getElementById('downloadBtn').textContent = 'Recording...';
        
        // 動画を最初から再生
        this.video.currentTime = 0;
        this.video.loop = false;
        
        const targetFPS = 30; // 30FPS for smooth playback
        const frameInterval = 1000 / targetFPS; // ミリ秒
        
        console.log(`Starting video recording: ${this.originalVideoDuration}s at ${targetFPS}FPS`);
        
        // 録画ループを開始
        const recordFrame = () => {
            if (!this.isRecording) return;
            
            const currentTime = performance.now();
            const elapsedTime = (currentTime - this.recordingStartTime) / 1000;
            
            if (elapsedTime >= this.originalVideoDuration) {
                this.stopVideoRecording();
                return;
            }
            
            // フレームレート制限（30FPS）
            if (this.lastRecordFrameTime && currentTime - this.lastRecordFrameTime < frameInterval) {
                requestAnimationFrame(recordFrame);
                return;
            }
            this.lastRecordFrameTime = currentTime;
            
            // 現在のキャンバスを画像として保存
            try {
                const frameDataURL = this.outputCanvas.toDataURL('image/png', 0.9);
                this.recordedFrames.push({
                    dataURL: frameDataURL,
                    timestamp: elapsedTime
                });
                
                // 録画進捗を更新
                const progress = (elapsedTime / this.originalVideoDuration) * 100;
                document.getElementById('recordingStatus').textContent = `Recording... ${progress.toFixed(1)}%`;
                
            } catch (error) {
                console.error('Frame capture error:', error);
            }
            
            // 次のフレームをスケジュール
            requestAnimationFrame(recordFrame);
        };
        
        // 録画開始
        recordFrame();
        
        // 動画再生開始
        this.video.play().then(() => {
            console.log('Video playback started for recording');
        }).catch((error) => {
            console.error('Failed to start video playback for recording:', error);
            this.isRecording = false;
            this.hideRecordingStatus();
        });
    }

    stopVideoRecording() {
        if (this.isRecording) {
            this.isRecording = false;
            
            // 動画の場合のみ動画を停止
            if (this.isVideo && this.video) {
                this.video.pause();
                this.video.loop = true; // ループを元に戻す
            }
            
            // 録画専用アニメーションを停止
            this.stopAutoAnimationForRecording();
            
            // 録画されたフレームからGIFを作成
            this.createGIFFromFrames();
            
            this.hideRecordingStatus();
            console.log('Video recording stopped');
        }
    }

    hideRecordingStatus() {
        document.getElementById('recordingStatus').style.display = 'none';
        document.getElementById('downloadBtn').disabled = false;
        document.getElementById('downloadBtn').textContent = this.isVideo ? 'Download Video' : 'Download Animation';
    }

    createGIFFromFrames() {
        if (!this.recordedFrames || this.recordedFrames.length === 0) {
            console.error('No frames recorded');
            return;
        }
        
        console.log(`Processing ${this.recordedFrames.length} recorded frames`);
        
        // ユーザーに選択肢を提供
        const choice = confirm(
            '録画完了！\n\n' +
            'OK: WebM動画としてダウンロード（推奨）\n' +
            'キャンセル: PNGフレームをZIPでダウンロード\n\n' +
            'WebMは軽量で直接再生可能、ZIPは高品質フレームです。'
        );
        
        if (choice) {
            this.createWebMFromFrames();
        } else {
            this.createZIPFromFrames();
        }
    }
    
    createWebMFromFrames() {
        console.log('Creating WebM video from frames');
        this.createWebMVideo();
    }
    
    createWebMVideo() {
        console.log('Creating WebM video from recorded frames');
        
        // 進捗表示
        document.getElementById('recordingStatus').style.display = 'flex';
        document.getElementById('recordingStatus').textContent = 'Creating WebM video...';
        
        // 一時的なキャンバスを作成して録画
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.outputCanvas.width;
        tempCanvas.height = this.outputCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // キャンバスからストリームを取得
        const stream = tempCanvas.captureStream(30);
        
        // WebM形式をチェック
        const webmTypes = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        
        let selectedType = null;
        for (const type of webmTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                selectedType = type;
                console.log('Selected WebM format:', type);
                break;
            }
        }
        
        if (!selectedType) {
            console.warn('WebM not supported, falling back to ZIP');
            document.getElementById('recordingStatus').style.display = 'none';
            this.createZIPFromFrames();
            return;
        }
        
        // MediaRecorderの設定
        const recorderOptions = {
            mimeType: selectedType,
            videoBitsPerSecond: 6000000 // 6 Mbps for good quality
        };
        
        try {
            const mediaRecorder = new MediaRecorder(stream, recorderOptions);
            const chunks = [];
            
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = () => {
                const blob = new Blob(chunks, { type: selectedType });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `slit-scan-video-${Date.now()}.webm`;
                link.click();
                
                // メモリクリーンアップ
                URL.revokeObjectURL(url);
                this.recordedFrames = [];
                
                // 進捗表示を隠す
                document.getElementById('recordingStatus').style.display = 'none';
                
                console.log('WebM video downloaded');
                
                // 成功メッセージを表示
                setTimeout(() => {
                    alert(
                        'WebM動画をダウンロードしました！\n\n' +
                        'MP4に変換するには:\n' +
                        '• Online-Convert.com\n' +
                        '• CloudConvert.com\n' +
                        '• FFmpeg: ffmpeg -i input.webm output.mp4\n\n' +
                        'WebMはChrome、Firefox、Edgeで直接再生可能です。'
                    );
                }, 100);
            };
            
            // 録画開始
            mediaRecorder.start();
            
            // フレームを順次再生して録画
            let frameIndex = 0;
            const playFrames = () => {
                if (frameIndex >= this.recordedFrames.length) {
                    mediaRecorder.stop();
                    return;
                }
                
                // 進捗更新
                const progress = (frameIndex / this.recordedFrames.length) * 100;
                document.getElementById('recordingStatus').textContent = `Creating WebM video... ${progress.toFixed(1)}%`;
                
                // フレームを一時キャンバスに描画
                const img = new Image();
                img.onload = () => {
                    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
                    tempCtx.drawImage(img, 0, 0);
                    
                    frameIndex++;
                    setTimeout(playFrames, 33); // ~30 FPS
                };
                img.src = this.recordedFrames[frameIndex].dataURL;
            };
            
            playFrames();
            
        } catch (error) {
            console.error('WebM recording failed:', error);
            document.getElementById('recordingStatus').style.display = 'none';
            this.createZIPFromFrames();
        }
    }
    
    createMP4Video() {
        console.log('MP4 conversion not available, offering alternatives');
        
        const choice = confirm(
            'MP4変換機能は現在利用できません。\n\n' +
            'OK: WebM動画としてダウンロード（推奨）\n' +
            'キャンセル: PNGフレームをZIPでダウンロード\n\n' +
            'WebMは軽量で、オンラインツールでMP4に変換できます。'
        );
        
        if (choice) {
            this.createWebMVideo();
        } else {
            this.createZIPFromFrames();
        }
    }
    
    createZIPFromFrames() {
        console.log('Creating ZIP from frames');
        
        const zip = new JSZip();
        const folder = zip.folder("frames");
        
        this.recordedFrames.forEach((frame, index) => {
            // DataURLからBase64データを抽出
            const base64Data = frame.dataURL.split(',')[1];
            folder.file(`frame_${index.toString().padStart(4, '0')}.png`, base64Data, {base64: true});
        });
        
        // メタデータファイルを作成
        const metadata = {
            frameCount: this.recordedFrames.length,
            duration: this.recordedFrames[this.recordedFrames.length - 1].timestamp,
            fps: this.recordedFrames.length / this.recordedFrames[this.recordedFrames.length - 1].timestamp,
            canvasWidth: this.outputCanvas.width,
            canvasHeight: this.outputCanvas.height
        };
        
        folder.file("metadata.json", JSON.stringify(metadata, null, 2));
        
        // ZIPファイルをダウンロード
        zip.generateAsync({type: "blob"}).then((content) => {
            const url = URL.createObjectURL(content);
            const link = document.createElement('a');
            link.href = url;
            link.download = `slit-scan-frames-${Date.now()}.zip`;
            link.click();
            
            // メモリクリーンアップ
            URL.revokeObjectURL(url);
            this.recordedFrames = [];
            
            console.log('Animation frames downloaded as ZIP');
            
            // 成功メッセージを表示
            setTimeout(() => {
                alert(
                    'PNGフレームをZIPでダウンロードしました！\n\n' +
                    '動画に変換するには:\n' +
                    '• FFmpeg: ffmpeg -framerate 30 -i frame_%04d.png output.mp4\n' +
                    '• Online-Convert.com\n' +
                    '• CloudConvert.com\n\n' +
                    'フレームは高品質PNG形式で保存されています。'
                );
            }, 100);
        });
    }
}

        // アプリケーションの初期化
        document.addEventListener('DOMContentLoaded', () => {
            try {
                console.log('Initializing SlitScanEffect application...');
                window.slitScanEffect = new SlitScanEffect();
                console.log('SlitScanEffect application initialized successfully');
                
                // 動画形式のサポート状況をチェック
                checkVideoFormatSupport();
            } catch (error) {
                console.error('Failed to initialize SlitScanEffect application:', error);
                alert('アプリケーションの初期化に失敗しました。ページを再読み込みしてください。');
            }
        });

        function checkVideoFormatSupport() {
            const formats = [
                { name: 'MP4 (H.264)', type: 'video/mp4;codecs=h264' },
                { name: 'MP4', type: 'video/mp4' },
                { name: 'WebM (VP9)', type: 'video/webm;codecs=vp9' },
                { name: 'WebM (H.264)', type: 'video/webm;codecs=h264' },
                { name: 'WebM', type: 'video/webm' }
            ];
            
            console.log('Video format support:');
            formats.forEach(format => {
                const supported = MediaRecorder.isTypeSupported(format.type);
                console.log(`${format.name}: ${supported ? '✅' : '❌'}`);
            });
        } 