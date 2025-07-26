class SlitScanEffect {
    constructor() {
        this.sourceCanvas = document.getElementById('sourceCanvas');
        this.outputCanvas = document.getElementById('outputCanvas');
        this.videoPreview = document.getElementById('videoPreview');
        this.sourceCtx = this.sourceCanvas.getContext('2d');
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
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('uploadBtn').addEventListener('click', () => {
            document.getElementById('imageInput').click();
        });

        document.getElementById('imageInput').addEventListener('change', (e) => {
            this.handleFileUpload(e.target.files[0]);
        });

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

        // スライダーの値を表示
        document.getElementById('intensity').addEventListener('input', (e) => {
            document.getElementById('intensityValue').textContent = e.target.value;
            // 静止画の場合、リアルタイムで適用
            if (!this.isVideo) {
                this.processFrame();
            }
        });

        document.getElementById('stretchAmount').addEventListener('input', (e) => {
            document.getElementById('stretchAmountValue').textContent = e.target.value;
            // 静止画の場合、リアルタイムで適用
            if (!this.isVideo) {
                this.processFrame();
            }
        });

        document.getElementById('speed').addEventListener('input', (e) => {
            document.getElementById('speedValue').textContent = e.target.value;
            // 静止画の場合、リアルタイムで適用
            if (!this.isVideo) {
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
                if (!this.isVideo && !this.autoMode) {
                    this.processFrame();
                }
            });
        });

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

        // ドラッグ&ドロップ機能
        const uploadArea = document.getElementById('uploadArea');
        
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileUpload(files[0]);
            }
        });
        
        uploadArea.addEventListener('click', () => {
            document.getElementById('imageInput').click();
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
        const img = new Image();
        img.onload = () => {
            this.isVideo = false;
            this.setupCanvasWithAspectRatio(img.width, img.height);
            this.sourceCtx.drawImage(img, 0, 0);
            this.outputCtx.drawImage(img, 0, 0);
            
            // 静止画の場合、初期エフェクトを適用
            this.processFrame();
            
            // Hide video preview
            this.videoPreview.style.display = 'none';
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
            
            this.processFrame();
            this.animationId = requestAnimationFrame(animate);
        };
        animate();
    }

    processFrame() {
        // フレーム処理の制限（120FPS制限で高パフォーマンス）
        if (this.lastFrameTime && performance.now() - this.lastFrameTime < 8.33) {
            return; // 約120FPS制限
        }
        this.lastFrameTime = performance.now();

        if (this.isVideo && this.video && !this.video.paused && !this.video.ended) {
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

        const effectType = document.getElementById('effectType').value;
        const intensity = parseInt(document.getElementById('intensity').value) / 100;
        const direction = document.getElementById('direction').value;
        const stretchType = document.getElementById('stretchType').value;
        const stretchAmount = parseInt(document.getElementById('stretchAmount').value) / 100;

        // エフェクト適用前にキャンバスをクリア
        this.outputCtx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);

        switch (effectType) {
            case 'slit-scan':
                this.applySlitScanEffect(intensity, direction, stretchType, stretchAmount);
                break;
            case 'pixel-sort':
                this.applyPixelSortEffect(intensity, direction);
                break;
            case 'glitch':
                this.applyGlitchEffect(intensity);
                break;
            case 'combined':
                this.applyCombinedEffect(intensity, direction, stretchType, stretchAmount);
                break;
        }
    }

    applySlitScanEffect(intensity, direction, stretchType, stretchAmount) {
        const imageData = this.sourceCtx.getImageData(0, 0, this.sourceCanvas.width, this.sourceCanvas.height);
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        
        const outputData = new Uint8ClampedArray(data);
        const centerX = width / 2;
        const centerY = height / 2;
        
        // 引き伸ばし量の計算
        const getStretchFactor = (x, y) => {
            switch (stretchType) {
                case 'uniform':
                    return stretchAmount;
                case 'gradient':
                    return stretchAmount * (x / width + y / height) / 2;
                case 'random':
                    return stretchAmount * (0.5 + Math.random() * 0.5);
                case 'center':
                    const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
                    const maxDistance = Math.sqrt(centerX ** 2 + centerY ** 2);
                    return stretchAmount * (1 - distance / maxDistance);
                case 'edges':
                    const edgeDistance = Math.min(x, y, width - x, height - y);
                    const maxEdgeDistance = Math.min(centerX, centerY);
                    return stretchAmount * (edgeDistance / maxEdgeDistance);
                default:
                    return stretchAmount;
            }
        };

        if (direction === 'vertical') {
            for (let x = 0; x < width; x++) {
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
    }

    applyPixelSortEffect(intensity, direction) {
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
    }

    applyCombinedEffect(intensity, direction, stretchType, stretchAmount) {
        this.applySlitScanEffect(intensity * 0.7, direction, stretchType, stretchAmount);
        this.applyPixelSortEffect(intensity * 0.5, direction);
        this.applyGlitchEffect(intensity * 0.3);
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
                // ストレッチ量を余弦波で変化させる（0-200の範囲）
                const stretchAmount = Math.abs(Math.cos(this.autoTime * autoSpeed * 1.5)) * 200;
                document.getElementById('stretchAmount').value = Math.round(stretchAmount);
                document.getElementById('stretchAmountValue').textContent = Math.round(stretchAmount);
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
                // ストレッチ量を余弦波で変化させる（0-200の範囲）
                const stretchAmount = Math.abs(Math.cos(this.recordingTime * autoSpeed * 1.5)) * 200;
                document.getElementById('stretchAmount').value = Math.round(stretchAmount);
                document.getElementById('stretchAmountValue').textContent = Math.round(stretchAmount);
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
        this.recordedChunks = [];
        
        // 録画ステータスを表示
        document.getElementById('recordingStatus').style.display = 'flex';
        document.getElementById('downloadBtn').disabled = true;
        document.getElementById('downloadBtn').textContent = 'Recording...';
        
        // 録画時間を設定（ユーザーが選択した時間）
        const recordingDuration = parseInt(document.getElementById('recordingDuration').value); // 秒
        
        // MediaRecorder の設定 - 超高画質
        const stream = this.outputCanvas.captureStream(120); // 120 FPS for ultra high quality
        
        // ユーザーが選択した形式と品質を取得
        const userFormat = document.getElementById('videoFormat').value;
        const userQuality = document.getElementById('videoQuality').value;
        
        // サポートされている形式をチェック
        let supportedTypes = [];
        
        if (userFormat === 'mp4') {
            supportedTypes = [
                'video/mp4',
                'video/mp4;codecs=h264',
                'video/webm;codecs=h264'
            ];
        } else if (userFormat === 'webm') {
            supportedTypes = [
                'video/webm;codecs=vp9',
                'video/webm'
            ];
        } else {
            // Auto mode - 最適な形式を選択
            supportedTypes = [
                'video/mp4',
                'video/mp4;codecs=h264',
                'video/webm;codecs=h264',
                'video/webm;codecs=vp9',
                'video/webm'
            ];
        }
        
        let selectedType = null;
        for (const type of supportedTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                selectedType = type;
                console.log('Selected video format:', type);
                break;
            }
        }
        
        if (!selectedType) {
            console.warn('Selected format not supported, falling back to default');
            // フォールバック用の形式をチェック
            const fallbackTypes = ['video/webm;codecs=vp9', 'video/webm'];
            for (const type of fallbackTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    selectedType = type;
                    break;
                }
            }
            if (!selectedType) {
                selectedType = 'video/webm';
            }
        }
        
        // 超高品質設定（静止画用）
        let bitrate = 25000000; // 25 Mbps for ultra high quality image recording
        switch (userQuality) {
            case 'high':
                bitrate = 25000000; // 25 Mbps
                break;
            case 'medium':
                bitrate = 15000000; // 15 Mbps
                break;
            case 'low':
                bitrate = 8000000; // 8 Mbps
                break;
        }
        
        // 高品質設定
        const recorderOptions = {
            mimeType: selectedType,
            videoBitsPerSecond: bitrate
        };
        
        console.log(`Image recording with bitrate: ${bitrate / 1000000} Mbps`);
        console.log(`Canvas resolution: ${this.outputCanvas.width}x${this.outputCanvas.height}`);
        console.log(`Frame rate: 120 FPS`);
        console.log(`Recording duration: ${recordingDuration} seconds`);
        console.log(`Estimated file size: ~${Math.round((bitrate * recordingDuration) / 8000000)} MB`);
        
        // ビットレート設定がサポートされていない場合のフォールバック
        try {
            this.mediaRecorder = new MediaRecorder(stream, recorderOptions);
        } catch (error) {
            console.warn('High bitrate not supported, using default settings:', error);
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: selectedType
            });
        }

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            this.createVideoDownload(selectedType);
        };

        // 録画開始
        this.mediaRecorder.start();
        console.log('Image recording started with format:', selectedType);

        // 静止画の場合、自動アニメーションを開始（録画中のみ）
        if (!this.isVideo && this.autoMode) {
            this.startAutoAnimationForRecording();
        }

        // 指定時間後に録画停止
        setTimeout(() => {
            this.stopVideoRecording();
        }, recordingDuration * 1000);
    }

    startVideoRecording() {
        if (this.isRecording) {
            console.log('Already recording');
            return;
        }

        this.isRecording = true;
        this.recordedChunks = [];
        
        // 録画ステータスを表示
        document.getElementById('recordingStatus').style.display = 'flex';
        document.getElementById('downloadBtn').disabled = true;
        document.getElementById('downloadBtn').textContent = 'Recording...';
        
        // 動画を最初から再生
        this.video.currentTime = 0;
        this.video.loop = false;
        
        // MediaRecorder の設定 - 超高画質
        const stream = this.outputCanvas.captureStream(120); // 120 FPS for ultra high quality
        
        // ユーザーが選択した形式と品質を取得
        const userFormat = document.getElementById('videoFormat').value;
        const userQuality = document.getElementById('videoQuality').value;
        
        // サポートされている形式をチェック
        let supportedTypes = [];
        
        if (userFormat === 'mp4') {
            supportedTypes = [
                'video/mp4',
                'video/mp4;codecs=h264',
                'video/webm;codecs=h264'
            ];
        } else if (userFormat === 'webm') {
            supportedTypes = [
                'video/webm;codecs=vp9',
                'video/webm'
            ];
        } else {
            // Auto mode - 最適な形式を選択
            supportedTypes = [
                'video/mp4',
                'video/mp4;codecs=h264',
                'video/webm;codecs=h264',
                'video/webm;codecs=vp9',
                'video/webm'
            ];
        }
        
        let selectedType = null;
        for (const type of supportedTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                selectedType = type;
                console.log('Selected video format:', type);
                break;
            }
        }
        
        if (!selectedType) {
            console.warn('Selected format not supported, falling back to default');
            // フォールバック用の形式をチェック
            const fallbackTypes = ['video/webm;codecs=vp9', 'video/webm'];
            for (const type of fallbackTypes) {
                if (MediaRecorder.isTypeSupported(type)) {
                    selectedType = type;
                    break;
                }
            }
            if (!selectedType) {
                selectedType = 'video/webm';
            }
        }
        
        // 超高品質設定（動画用）
        let bitrate = 20000000; // デフォルト: 20 Mbps
        switch (userQuality) {
            case 'high':
                bitrate = 20000000; // 20 Mbps
                break;
            case 'medium':
                bitrate = 12000000; // 12 Mbps
                break;
            case 'low':
                bitrate = 6000000; // 6 Mbps
                break;
        }
        
        // 高品質設定
        const recorderOptions = {
            mimeType: selectedType,
            videoBitsPerSecond: bitrate
        };
        
        console.log(`Video recording with bitrate: ${bitrate / 1000000} Mbps`);
        console.log(`Canvas resolution: ${this.outputCanvas.width}x${this.outputCanvas.height}`);
        console.log(`Frame rate: 120 FPS`);
        console.log(`Estimated file size: ~${Math.round((bitrate * this.originalVideoDuration) / 8000000)} MB`);
        
        // ビットレート設定がサポートされていない場合のフォールバック
        try {
            this.mediaRecorder = new MediaRecorder(stream, recorderOptions);
        } catch (error) {
            console.warn('High bitrate not supported, using default settings:', error);
            this.mediaRecorder = new MediaRecorder(stream, {
                mimeType: selectedType
            });
        }

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            this.createVideoDownload(selectedType);
        };

        // 録画開始
        this.mediaRecorder.start();
        console.log('Video recording started with format:', selectedType);

        // 動画再生開始
        this.video.play().then(() => {
            // 動画の長さ分だけ録画
            setTimeout(() => {
                this.stopVideoRecording();
            }, this.originalVideoDuration * 1000);
        }).catch((error) => {
            console.error('Failed to start video playback for recording:', error);
            this.isRecording = false;
            this.hideRecordingStatus();
        });
    }

    stopVideoRecording() {
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.isRecording = false;
            
            // 動画の場合のみ動画を停止
            if (this.isVideo && this.video) {
                this.video.pause();
                this.video.loop = true; // ループを元に戻す
            }
            
            // 録画専用アニメーションを停止
            this.stopAutoAnimationForRecording();
            
            this.hideRecordingStatus();
            console.log('Video recording stopped');
        }
    }

    hideRecordingStatus() {
        document.getElementById('recordingStatus').style.display = 'none';
        document.getElementById('downloadBtn').disabled = false;
        document.getElementById('downloadBtn').textContent = this.isVideo ? 'Download Video' : 'Download Animation';
    }

    createVideoDownload(selectedType) {
        // ファイル拡張子を決定
        let fileExtension = 'webm';
        let mimeType = 'video/webm';
        
        if (selectedType.includes('mp4')) {
            fileExtension = 'mp4';
            mimeType = 'video/mp4';
        } else if (selectedType.includes('h264')) {
            fileExtension = 'mp4';
            mimeType = 'video/mp4';
        }
        
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `slit-scan-video.${fileExtension}`;
        link.click();
        
        // メモリクリーンアップ
        URL.revokeObjectURL(url);
        this.recordedChunks = [];
        
        console.log(`Video download created in ${fileExtension.toUpperCase()} format`);
        
        // 成功メッセージを表示
        setTimeout(() => {
            alert(`Video download completed in ${fileExtension.toUpperCase()} format! Check your downloads folder.`);
        }, 100);
    }
}

        // アプリケーションの初期化
        document.addEventListener('DOMContentLoaded', () => {
            new SlitScanEffect();
            
            // 動画形式のサポート状況をチェック
            checkVideoFormatSupport();
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