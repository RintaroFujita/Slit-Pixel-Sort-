# スリットスキャン効果ジェネレーター

このプロジェクトは、画像や動画にスリットスキャン効果を適用できるWebアプリケーションです。InstagramのReelsで見られるような、美しい抽象的な視覚効果を作成できます。

## 機能

### 1. スリットスキャン効果
- 垂直方向のストレッチ効果
- 水平方向のストレッチ効果
- 対角線方向のストレッチ効果
- アニメーション付きの動的効果

### 2. ピクセルソート効果
- 明度に基づくピクセルの並べ替え
- 垂直方向のソート
- カラーパレットの再構築

### 3. グリッチ効果
- ランダムな黒いブロック
- 白い線のオーバーレイ
- デジタルノイズ効果

### 4. 組み合わせ効果
- 複数の効果を同時に適用
- カスタマイズ可能な強度設定

## 使い方

1. **ファイルのアップロード**
   - 「画像/動画をアップロード」ボタンをクリック
   - 画像ファイル（JPG、PNG、GIF）または動画ファイル（MP4、MOV）を選択

2. **効果の設定**
   - 効果タイプを選択（スリットスキャン、ピクセルソート、グリッチ、組み合わせ）
   - 強度スライダーで効果の強さを調整（0-100）
   - 方向を選択（垂直、水平、対角線）
   - アニメーション速度を調整

3. **効果の適用**
   - 「効果を適用」ボタンをクリック
   - リアルタイムで効果が適用されます

4. **結果の保存**
   - 「ダウンロード」ボタンで結果をPNG形式で保存

## 技術仕様

- **フロントエンド**: HTML5, CSS3, JavaScript (ES6+)
- **グラフィックス**: HTML5 Canvas API
- **ファイル処理**: FileReader API
- **アニメーション**: requestAnimationFrame API

## ファイル構成

```
slit/
├── index.html          # メインのHTMLファイル
├── style.css           # スタイルシート
├── script.js           # JavaScriptロジック
└── README.md           # このファイル
```

## ブラウザ対応

- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## ライセンス

このプロジェクトはMITライセンスの下で公開されています。

## 今後の改善予定

- [ ] より多くの効果タイプの追加
- [ ] プリセット機能
- [ ] リアルタイムプレビュー
- [ ] 動画エクスポート機能
- [ ] モバイル対応の改善 