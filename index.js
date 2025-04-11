const express = require('express');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const chromium = require('puppeteer/lib/cjs/puppeteer/chromium');

const app = express();
const PORT = process.env.PORT || 3000;

// テンプレートエンジンの設定
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

// リクエストボディのパース
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ルートページ
app.get('/', (req, res) => {
  res.render('index', { results: null, url: '', error: null });
});

// クローラーシミュレーション実行
app.post('/simulate', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.render('index', { 
      results: null, 
      url: '', 
      error: 'URLを入力してください' 
    });
  }

  try {
    const results = await simulateCrawler(url);
    res.render('index', { results, url, error: null });
  } catch (error) {
    console.error('エラー:', error.message);
    res.render('index', { 
      results: null, 
      url, 
      error: `解析中にエラーが発生しました: ${error.message}` 
    });
  }
});

/**
 * クローラーシミュレーション実行関数
 * @param {string} url - 解析するURL
 * @returns {Object} - 解析結果
 */
async function simulateCrawler(url) {
  // URLを正規化
  const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
  
  // Puppeteerでページを取得（JavaScript実行あり）
  const browser = await puppeteer.launch({
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote'
    ],
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || await chromium.executablePath
  });
  const page = await browser.newPage();
  
  try {
    await page.goto(normalizedUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // HTML取得
    const renderedHtml = await page.content();
    
    // Puppeteerなしで通常のHTTP要求（Javascriptなし）
    const { data: rawHtml } = await axios.get(normalizedUrl);
    
    // Puppeteerなしのスクリーンショット（レンダリング前）
    await page.setJavaScriptEnabled(false);
    await page.reload({ waitUntil: 'networkidle2' });
    const screenshotWithoutJs = await page.screenshot({ encoding: 'base64' });
    
    // Puppeteerありのスクリーンショット（レンダリング後）
    await page.setJavaScriptEnabled(true);
    await page.reload({ waitUntil: 'networkidle2' });
    const screenshotWithJs = await page.screenshot({ encoding: 'base64' });
    
    // 解析結果
    const $ = cheerio.load(renderedHtml);
    
    // メタデータ
    const title = $('title').text() || 'タイトルが見つかりません';
    const description = $('meta[name="description"]').attr('content') || 'ディスクリプションが見つかりません';
    const h1Count = $('h1').length;
    const h1Text = $('h1').map((i, el) => $(el).text().trim()).get();
    
    // リンク分析
    const links = $('a').map((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      const isInternal = href && (href.startsWith('/') || href.includes(new URL(normalizedUrl).hostname));
      return { href, text, isInternal };
    }).get();
    
    // 画像分析
    const images = $('img').map((i, el) => {
      const src = $(el).attr('src');
      const alt = $(el).attr('alt') || 'alt属性なし';
      return { src, alt };
    }).get();
    
    // ロボット指示
    const robotsContent = $('meta[name="robots"]').attr('content') || 'robots設定なし';
    const robotsTxt = await fetchRobotsTxt(normalizedUrl);
    
    // ブロッキング要素
    const noIndexCount = $('meta[content*="noindex"]').length;
    const hasCrawlableLinks = links.some(link => link.isInternal);
    
    // モバイルフレンドリーチェック
    const hasViewport = $('meta[name="viewport"]').length > 0;
    
    // canonicalチェック
    const canonical = $('link[rel="canonical"]').attr('href') || 'canonicalタグなし';
    
    // ページ速度測定（基本的な指標）
    const pageLoadTimeMs = await page.evaluate(() => {
      return window.performance.timing.loadEventEnd - window.performance.timing.navigationStart;
    });
    
    // ヘッディング構造チェック
    const headings = {
      h1: h1Count,
      h2: $('h2').length,
      h3: $('h3').length,
      h4: $('h4').length,
      h5: $('h5').length,
      h6: $('h6').length
    };
    
    // スキーママークアップの存在確認
    const hasSchemaMarkup = renderedHtml.includes('application/ld+json') || 
                           $('[itemscope]').length > 0 || 
                           $('[itemtype]').length > 0;
    
    // SSL使用状況
    const usesHttps = normalizedUrl.startsWith('https://');
    
    // 評価とアドバイスを生成
    const evaluationResults = generateEvaluation({
      title,
      description,
      headings,
      links,
      images,
      hasViewport,
      usesHttps,
      hasSchemaMarkup,
      pageLoadTimeMs,
      rawHtmlSize: rawHtml.length,
      renderedHtmlSize: renderedHtml.length,
      renderRatio: renderedHtml.length / rawHtml.length,
      noIndexCount,
      robotsContent,
      canonical
    });
    
    await browser.close();
    
    return {
      pageInfo: {
        title,
        description,
        url: normalizedUrl,
        h1Count,
        h1Text,
        canonical
      },
      robotsInfo: {
        metaRobots: robotsContent,
        robotsTxt,
        blockedElements: {
          noIndexCount,
          hasCrawlableLinks
        }
      },
      contentAnalysis: {
        links: {
          total: links.length,
          internal: links.filter(l => l.isInternal).length,
          external: links.filter(l => !l.isInternal).length,
          sample: links.slice(0, 10)
        },
        images: {
          total: images.length,
          withAlt: images.filter(img => img.alt && img.alt !== 'alt属性なし').length,
          withoutAlt: images.filter(img => !img.alt || img.alt === 'alt属性なし').length,
          sample: images.slice(0, 10)
        },
        headings: headings
      },
      mobileInfo: {
        hasViewport
      },
      renderedVsRaw: {
        rawHtmlSize: rawHtml.length,
        renderedHtmlSize: renderedHtml.length,
        ratio: renderedHtml.length / rawHtml.length,
        pageLoadTimeMs,
        screenshotWithJs,
        screenshotWithoutJs
      },
      technicalSEO: {
        usesHttps,
        hasSchemaMarkup
      },
      evaluation: evaluationResults
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/**
 * robots.txtを取得する関数
 * @param {string} url - WebサイトのベースとなるURL
 * @returns {string} - robots.txtの内容
 */
async function fetchRobotsTxt(url) {
  try {
    const baseUrl = new URL(url);
    const robotsUrl = `${baseUrl.protocol}//${baseUrl.hostname}/robots.txt`;
    const response = await axios.get(robotsUrl, { timeout: 5000 });
    return response.data;
  } catch (error) {
    return 'robots.txtの取得に失敗しました';
  }
}

/**
 * 評価とアドバイスを生成する関数
 * @param {Object} data - 分析データ
 * @returns {Object} - 評価結果とアドバイス
 */
function generateEvaluation(data) {
  // 評価点の初期化
  let totalScore = 0;
  let maxPossibleScore = 0;
  const evaluationItems = [];
  
  // タイトル評価
  let titleScore = 0;
  let titleAdvice = [];
  if (data.title && data.title !== 'タイトルが見つかりません') {
    const titleLength = data.title.length;
    if (titleLength > 10 && titleLength <= 60) {
      titleScore = 10;
      titleAdvice.push('タイトルの長さは適切です (10〜60文字)');
    } else if (titleLength > 0 && titleLength <= 10) {
      titleScore = 3;
      titleAdvice.push('タイトルが短すぎます。もう少し詳細なタイトルを設定してください');
    } else if (titleLength > 60) {
      titleScore = 5;
      titleAdvice.push('タイトルが長すぎます。60文字以内に収めることをお勧めします');
    }
  } else {
    titleAdvice.push('タイトルが見つかりません。タイトルタグを適切に設定してください');
  }
  evaluationItems.push({
    name: 'タイトル',
    score: titleScore,
    maxScore: 10,
    advice: titleAdvice
  });
  totalScore += titleScore;
  maxPossibleScore += 10;
  
  // ディスクリプション評価
  let descScore = 0;
  let descAdvice = [];
  if (data.description && data.description !== 'ディスクリプションが見つかりません') {
    const descLength = data.description.length;
    if (descLength > 50 && descLength <= 160) {
      descScore = 10;
      descAdvice.push('メタディスクリプションの長さは適切です (50〜160文字)');
    } else if (descLength > 0 && descLength <= 50) {
      descScore = 3;
      descAdvice.push('メタディスクリプションが短すぎます。もう少し詳細な説明を追加してください');
    } else if (descLength > 160) {
      descScore = 5;
      descAdvice.push('メタディスクリプションが長すぎます。160文字以内に収めることをお勧めします');
    }
  } else {
    descAdvice.push('メタディスクリプションが見つかりません。検索結果での表示改善のため設定してください');
  }
  evaluationItems.push({
    name: 'メタディスクリプション',
    score: descScore,
    maxScore: 10,
    advice: descAdvice
  });
  totalScore += descScore;
  maxPossibleScore += 10;
  
  // 見出し構造評価
  let headingScore = 0;
  let headingAdvice = [];
  if (data.headings.h1 === 1) {
    headingScore += 5;
    headingAdvice.push('H1タグが適切に1つだけ使用されています');
  } else if (data.headings.h1 === 0) {
    headingAdvice.push('H1タグが見つかりません。ページの主要見出しにH1タグを使用してください');
  } else {
    headingScore += 2;
    headingAdvice.push(`H1タグが${data.headings.h1}個使用されています。理想的には1ページに1つだけにしてください`);
  }
  
  const hasProperHeadingStructure = data.headings.h2 > 0 && 
                                  data.headings.h1 <= data.headings.h2 && 
                                  data.headings.h2 >= data.headings.h3;
  if (hasProperHeadingStructure) {
    headingScore += 5;
    headingAdvice.push('見出し構造が適切に階層化されています');
  } else if (data.headings.h2 > 0 || data.headings.h3 > 0) {
    headingScore += 2;
    headingAdvice.push('見出し構造に問題があります。H1→H2→H3の順で適切に階層化してください');
  } else {
    headingAdvice.push('見出しタグ (H2, H3など) が見つかりません。コンテンツ構造を明確にするために使用してください');
  }
  evaluationItems.push({
    name: '見出し構造',
    score: headingScore,
    maxScore: 10,
    advice: headingAdvice
  });
  totalScore += headingScore;
  maxPossibleScore += 10;
  
  // 画像最適化評価
  let imageScore = 0;
  let imageAdvice = [];
  if (data.images.length > 0) {
    const altRatio = data.images.withAlt / data.images.total;
    if (altRatio === 1) {
      imageScore = 10;
      imageAdvice.push('すべての画像にalt属性が設定されています。素晴らしいです！');
    } else if (altRatio >= 0.7) {
      imageScore = 7;
      imageAdvice.push(`${data.images.withoutAlt}個の画像にalt属性がありません。すべての画像に適切なalt属性を設定してください`);
    } else if (altRatio > 0) {
      imageScore = 4;
      imageAdvice.push(`多くの画像 (${data.images.withoutAlt}個) にalt属性がありません。アクセシビリティとSEOのためにalt属性を追加してください`);
    } else {
      imageAdvice.push('すべての画像にalt属性がありません。検索エンジンが画像を理解できるようalt属性を追加してください');
    }
  } else {
    imageScore = 5;
    imageAdvice.push('画像が見つかりません。適切な画像の使用はユーザーエクスペリエンスを向上させることがあります');
  }
  evaluationItems.push({
    name: '画像最適化',
    score: imageScore,
    maxScore: 10,
    advice: imageAdvice
  });
  totalScore += imageScore;
  maxPossibleScore += 10;
  
  // モバイル対応評価
  let mobileScore = 0;
  let mobileAdvice = [];
  if (data.hasViewport) {
    mobileScore = 10;
    mobileAdvice.push('ビューポートメタタグが適切に設定されています');
  } else {
    mobileAdvice.push('ビューポートメタタグが見つかりません。モバイルフレンドリーにするために追加してください');
  }
  evaluationItems.push({
    name: 'モバイル対応',
    score: mobileScore,
    maxScore: 10,
    advice: mobileAdvice
  });
  totalScore += mobileScore;
  maxPossibleScore += 10;
  
  // HTTPS評価
  let httpsScore = 0;
  let httpsAdvice = [];
  if (data.usesHttps) {
    httpsScore = 10;
    httpsAdvice.push('HTTPSが適切に使用されています。セキュリティが確保されています');
  } else {
    httpsAdvice.push('HTTPSが使用されていません。セキュリティとSEOのためにHTTPSに移行することを強く推奨します');
  }
  evaluationItems.push({
    name: 'HTTPS',
    score: httpsScore,
    maxScore: 10,
    advice: httpsAdvice
  });
  totalScore += httpsScore;
  maxPossibleScore += 10;
  
  // リンク評価
  let linkScore = 0;
  let linkAdvice = [];
  if (data.links.length > 0) {
    if (data.links.filter(l => l.isInternal).length > 0) {
      linkScore += 5;
      linkAdvice.push('内部リンクが適切に設定されています');
    } else {
      linkAdvice.push('内部リンクが見つかりません。サイト内の関連ページへのリンクを追加してください');
    }
    
    if (data.links.filter(l => !l.isInternal).length > 0) {
      linkScore += 3;
      linkAdvice.push('外部リンクがあります。これは関連性と信頼性の向上につながります');
    } else {
      linkAdvice.push('外部リンクが見つかりません。権威あるサイトへのリンクを追加すると有益な場合があります');
    }
    
    // テキストのないリンクをチェック
    const emptyTextLinks = data.links.filter(l => !l.text).length;
    if (emptyTextLinks === 0) {
      linkScore += 2;
    } else {
      linkAdvice.push(`${emptyTextLinks}個のリンクにテキストがありません。すべてのリンクに説明的なテキストを追加してください`);
    }
  } else {
    linkAdvice.push('リンクが見つかりません。ユーザーとクローラーのためのナビゲーションを提供するリンクを追加してください');
  }
  evaluationItems.push({
    name: 'リンク構造',
    score: linkScore,
    maxScore: 10,
    advice: linkAdvice
  });
  totalScore += linkScore;
  maxPossibleScore += 10;
  
  // JavaScriptレンダリング評価
  let jsScore = 0;
  let jsAdvice = [];
  const renderRatio = data.renderRatio;
  if (renderRatio <= 1.1) {
    jsScore = 10;
    jsAdvice.push('ページは主に静的コンテンツで構成されています。クローラーが認識しやすい状態です');
  } else if (renderRatio <= 1.3) {
    jsScore = 7;
    jsAdvice.push('JavaScriptで一部コンテンツが生成されています。重要なコンテンツはHTMLに直接記述することをお勧めします');
  } else if (renderRatio <= 2) {
    jsScore = 4;
    jsAdvice.push('JavaScriptに大きく依存しています。重要なコンテンツはHTMLに直接記述するか、サーバーサイドレンダリングを検討してください');
  } else {
    jsScore = 0;
    jsAdvice.push('ページのほとんどがJavaScriptで生成されています。クローラーがコンテンツを見落とす可能性が高いです');
  }
  evaluationItems.push({
    name: 'JavaScript依存度',
    score: jsScore,
    maxScore: 10,
    advice: jsAdvice
  });
  totalScore += jsScore;
  maxPossibleScore += 10;
  
  // ページ速度評価
  let speedScore = 0;
  let speedAdvice = [];
  if (data.pageLoadTimeMs < 1000) {
    speedScore = 10;
    speedAdvice.push(`ページ読み込み時間は${(data.pageLoadTimeMs/1000).toFixed(2)}秒で、非常に高速です`);
  } else if (data.pageLoadTimeMs < 2500) {
    speedScore = 7;
    speedAdvice.push(`ページ読み込み時間は${(data.pageLoadTimeMs/1000).toFixed(2)}秒で、良好です`);
  } else if (data.pageLoadTimeMs < 4000) {
    speedScore = 4;
    speedAdvice.push(`ページ読み込み時間は${(data.pageLoadTimeMs/1000).toFixed(2)}秒で、改善の余地があります`);
  } else {
    speedScore = 0;
    speedAdvice.push(`ページ読み込み時間は${(data.pageLoadTimeMs/1000).toFixed(2)}秒で、改善が必要です`);
  }
  evaluationItems.push({
    name: 'ページ速度',
    score: speedScore,
    maxScore: 10,
    advice: speedAdvice
  });
  totalScore += speedScore;
  maxPossibleScore += 10;
  
  // 構造化データ評価
  let schemaScore = 0;
  let schemaAdvice = [];
  if (data.hasSchemaMarkup) {
    schemaScore = 10;
    schemaAdvice.push('構造化データが検出されました。これは検索結果での表示を改善します');
  } else {
    schemaAdvice.push('構造化データが見つかりません。JSON-LDなどの構造化データを追加することで、リッチスニペットが表示される可能性が高まります');
  }
  evaluationItems.push({
    name: '構造化データ',
    score: schemaScore,
    maxScore: 10,
    advice: schemaAdvice
  });
  totalScore += schemaScore;
  maxPossibleScore += 10;
  
  // インデックス可能性評価
  let indexScore = 0;
  let indexAdvice = [];
  if (data.noIndexCount > 0 || data.robotsContent.includes('noindex')) {
    indexScore = 0;
    indexAdvice.push('このページはnoindexが設定されており、検索エンジンにインデックスされません');
  } else {
    indexScore = 10;
    indexAdvice.push('このページはインデックス可能です');
  }
  evaluationItems.push({
    name: 'インデックス可能性',
    score: indexScore,
    maxScore: 10,
    advice: indexAdvice
  });
  totalScore += indexScore;
  maxPossibleScore += 10;
  
  // 総合スコア（100点満点）
  const normalizedScore = Math.round((totalScore / maxPossibleScore) * 100);
  
  // 総合評価
  let overallRating;
  let overallAdvice = [];
  if (normalizedScore >= 90) {
    overallRating = '優秀';
    overallAdvice.push('ページのSEO対策は非常に優れています。この高い水準を維持しましょう');
  } else if (normalizedScore >= 70) {
    overallRating = '良好';
    overallAdvice.push('ページのSEO対策は良好です。より高いスコアを目指すため、詳細な改善点を確認してください');
  } else if (normalizedScore >= 50) {
    overallRating = '普通';
    overallAdvice.push('ページのSEO対策は基本的な要素を満たしていますが、改善の余地が多くあります');
  } else if (normalizedScore >= 30) {
    overallRating = '要改善';
    overallAdvice.push('ページのSEO対策に問題があります。詳細な改善点を確認し、優先的に対応してください');
  } else {
    overallRating = '緊急改善必要';
    overallAdvice.push('ページのSEO対策に重大な問題があります。検索エンジンでの表示が大きく制限される可能性があります');
  }
  
  // トップ3改善提案
  const improvementItems = evaluationItems
    .filter(item => item.score < item.maxScore)
    .sort((a, b) => (a.score / a.maxScore) - (b.score / b.maxScore))
    .slice(0, 3);
  
  const topImprovements = improvementItems.map(item => {
    return {
      area: item.name,
      advice: item.advice[0]
    };
  });
  
  return {
    overallScore: normalizedScore,
    rating: overallRating,
    overallAdvice,
    detailedScores: evaluationItems,
    topImprovements
  };
}

// サーバー起動
app.listen(PORT, () => {
  console.log(`クローラーシミュレーターサーバーが起動しました: http://localhost:${PORT}`);
}); 