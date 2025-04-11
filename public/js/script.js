/**
 * クローラーシミュレーターのフロントエンドスクリプト
 */
document.addEventListener('DOMContentLoaded', () => {
  // タブ切り替え機能
  setupTabs();
  
  // URL入力フォームの動作調整
  setupUrlInput();
  
  // 評価スコアの円グラフをアニメーション
  animateScoreCircles();
});

/**
 * タブ切り替え機能のセットアップ
 */
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  if (tabButtons.length === 0) return;
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // 現在のアクティブタブを解除
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // クリックされたタブをアクティブに
      button.classList.add('active');
      const tabId = button.getAttribute('data-tab');
      const activeContent = document.getElementById(tabId);
      if (activeContent) {
        activeContent.classList.add('active');
      }
    });
  });
}

/**
 * URL入力フォームのセットアップ
 */
function setupUrlInput() {
  const urlInput = document.getElementById('url');
  if (!urlInput) return;
  
  // URLの先頭に https:// がない場合、自動補完のヒントを表示
  urlInput.addEventListener('blur', () => {
    const value = urlInput.value.trim();
    if (value && !value.startsWith('http://') && !value.startsWith('https://')) {
      // URLだけどプロトコルがない場合はプレースホルダーでヒント
      urlInput.setAttribute('placeholder', `例: https://${value}`);
    }
  });
  
  // フォーカス時に元のプレースホルダーに戻す
  urlInput.addEventListener('focus', () => {
    urlInput.setAttribute('placeholder', 'URLを入力してください（例: example.com）');
  });
}

/**
 * 評価スコアの円グラフをアニメーションで表示
 */
function animateScoreCircles() {
  const scoreCircles = document.querySelectorAll('.score-circle');
  
  scoreCircles.forEach(circle => {
    const score = parseInt(circle.getAttribute('data-score'), 10);
    if (isNaN(score)) return;
    
    // スコアに応じた色を決定
    let color = getScoreColor(score);
    
    // アニメーションの開始
    setTimeout(() => {
      // conic-gradientをアニメーションで変化させる
      const startPercent = 0;
      const endPercent = score;
      const duration = 1500; // ミリ秒
      const startTime = performance.now();
      
      function updateCircle(currentTime) {
        const elapsedTime = currentTime - startTime;
        let currentPercent = Math.min(endPercent, startPercent + (endPercent - startPercent) * (elapsedTime / duration));
        
        circle.style.background = `conic-gradient(
          ${color} 0%, 
          ${color} ${currentPercent}%, 
          #e0e0e0 ${currentPercent}%
        )`;
        
        if (elapsedTime < duration && currentPercent < endPercent) {
          requestAnimationFrame(updateCircle);
        }
      }
      
      requestAnimationFrame(updateCircle);
    }, 300);
  });
}

/**
 * スコアに応じた色を取得
 * @param {number} score - 評価スコア（0-100）
 * @returns {string} - 対応する色のCSS値
 */
function getScoreColor(score) {
  if (score >= 90) {
    return 'var(--success-color)';
  } else if (score >= 70) {
    return 'var(--primary-color)';
  } else if (score >= 50) {
    return 'var(--accent-color)';
  } else if (score >= 30) {
    return '#ff9800';
  } else {
    return 'var(--secondary-color)';
  }
}

// 画像の拡大表示機能
const screenshots = document.querySelectorAll('.screenshot img');
screenshots.forEach(img => {
  img.addEventListener('click', () => {
    // 画像をモーダルで表示する機能は後々実装する予定
    // 現時点ではシンプルに画像を新しいタブで開く
    window.open(img.src, '_blank');
  });
}); 