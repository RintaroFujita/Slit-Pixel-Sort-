// Web Worker for CPU-intensive image processing
self.onmessage = function(e) {
    const { type, data, width, height, intensity, direction, stretchType, stretchAmount } = e.data;
    
    switch (type) {
        case 'slit-scan':
            const slitScanResult = applySlitScanEffect(data, width, height, intensity, direction, stretchType, stretchAmount);
            self.postMessage({ type: 'slit-scan-result', data: slitScanResult });
            break;
            
        case 'pixel-sort':
            const pixelSortResult = applyPixelSortEffect(data, width, height, intensity, direction);
            self.postMessage({ type: 'pixel-sort-result', data: pixelSortResult });
            break;
            
        case 'glitch':
            const glitchResult = applyGlitchEffect(data, width, height, intensity);
            self.postMessage({ type: 'glitch-result', data: glitchResult });
            break;
            
        case 'combined':
            const combinedResult = applyCombinedEffect(data, width, height, intensity, direction, stretchType, stretchAmount);
            self.postMessage({ type: 'combined-result', data: combinedResult });
            break;
    }
};

function applySlitScanEffect(data, width, height, intensity, direction, stretchType, stretchAmount) {
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
            const waveOffset = Math.sin(x * 0.01) * intensity * 50;
            
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
            const waveOffset = Math.sin(y * 0.01) * intensity * 50;
            
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
    }
    
    return outputData;
}

function applyPixelSortEffect(data, width, height, intensity, direction) {
    const outputData = new Uint8ClampedArray(data);
    
    if (direction === 'horizontal') {
        for (let y = 0; y < height; y++) {
            const row = [];
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                row.push({
                    r: data[index],
                    g: data[index + 1],
                    b: data[index + 2],
                    a: data[index + 3],
                    brightness: (data[index] + data[index + 1] + data[index + 2]) / 3
                });
            }
            
            // ソート
            row.sort((a, b) => a.brightness - b.brightness);
            
            // ソートされたデータを適用
            const sortIntensity = Math.floor(intensity * width);
            for (let x = 0; x < width; x++) {
                const targetIndex = (y * width + x) * 4;
                const sourceIndex = Math.min(sortIntensity, x);
                outputData[targetIndex] = row[sourceIndex].r;
                outputData[targetIndex + 1] = row[sourceIndex].g;
                outputData[targetIndex + 2] = row[sourceIndex].b;
                outputData[targetIndex + 3] = row[sourceIndex].a;
            }
        }
    } else if (direction === 'vertical') {
        for (let x = 0; x < width; x++) {
            const column = [];
            for (let y = 0; y < height; y++) {
                const index = (y * width + x) * 4;
                column.push({
                    r: data[index],
                    g: data[index + 1],
                    b: data[index + 2],
                    a: data[index + 3],
                    brightness: (data[index] + data[index + 1] + data[index + 2]) / 3
                });
            }
            
            // ソート
            column.sort((a, b) => a.brightness - b.brightness);
            
            // ソートされたデータを適用
            const sortIntensity = Math.floor(intensity * height);
            for (let y = 0; y < height; y++) {
                const targetIndex = (y * width + x) * 4;
                const sourceIndex = Math.min(sortIntensity, y);
                outputData[targetIndex] = column[sourceIndex].r;
                outputData[targetIndex + 1] = column[sourceIndex].g;
                outputData[targetIndex + 2] = column[sourceIndex].b;
                outputData[targetIndex + 3] = column[sourceIndex].a;
            }
        }
    }
    
    return outputData;
}

function applyGlitchEffect(data, width, height, intensity) {
    const outputData = new Uint8ClampedArray(data);
    
    for (let i = 0; i < data.length; i += 4) {
        const x = (i / 4) % width;
        const y = Math.floor((i / 4) / width);
        
        // ランダムなグリッチ効果
        if (Math.random() < intensity * 0.1) {
            const offset = Math.floor(Math.random() * 20) - 10;
            const sourceIndex = Math.max(0, Math.min(data.length - 4, i + offset * 4));
            
            outputData[i] = data[sourceIndex];
            outputData[i + 1] = data[sourceIndex + 1];
            outputData[i + 2] = data[sourceIndex + 2];
            outputData[i + 3] = data[sourceIndex + 3];
        }
        
        // 色チャンネルのシフト
        if (Math.random() < intensity * 0.05) {
            const shift = Math.floor(Math.random() * 10) - 5;
            const sourceIndex = Math.max(0, Math.min(data.length - 4, i + shift * 4));
            outputData[i] = data[sourceIndex];
        }
    }
    
    return outputData;
}

function applyCombinedEffect(data, width, height, intensity, direction, stretchType, stretchAmount) {
    // スリットスキャン効果を適用
    let result = applySlitScanEffect(data, width, height, intensity, direction, stretchType, stretchAmount);
    
    // グリッチ効果を追加
    result = applyGlitchEffect(result, width, height, intensity * 0.5);
    
    return result;
} 