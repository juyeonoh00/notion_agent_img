/**
 * Conversational Orchestrator: 대화형 Multi-Agent 조율
 *
 * ⚠️ 중요 변경사항:
 *
 * ❌ Mermaid 다이어그램 (텍스트 기반) - 더 이상 사용하지 않음
 *    - 이전에는 Mermaid 문법으로 텍스트 다이어그램 생성
 *    - 현재는 완전히 제거됨
 *
 * ✅ 이미지 다이어그램 (이미지 파일)
 *    - Image Agent가 AI 이미지 생성 프롬프트 제공
 *    - 사용자가 DALL-E, Midjourney 등에서 이미지 생성
 *    - 생성된 이미지를 문서에 삽입
 *    - 종류: 아키텍처, 플로우차트, 시퀀스, ERD, UI 목업 등
 *    - 예: "시스템 아키텍처 이미지 만들어줘", "플로우차트 그려줘"
 */

import { CodeAgent } from './agents/code-agent.js';
import { ReviewAgent } from './agents/review-agent.js';
import { NotionAgent } from './agents/notion-agent.js';
import { ImageAgent } from './agents/image-agent.js';
import { PromptAgent } from './agents/prompt-agent.js';
import { StateManager } from './state-manager.js';

export class ConversationalOrchestrator {
  constructor(config = {}) {
    this.codeAgent = new CodeAgent();
    this.reviewAgent = new ReviewAgent();
    this.notionAgent = new NotionAgent(config.notionApiKey);
    this.imageAgent = new ImageAgent({
      openai: config.openaiApiKey,
      gemini: config.geminiApiKey
    });

    this.stateManager = new StateManager(config.stateDir);
    this.promptAgent = new PromptAgent(this.stateManager);

    this.config = config;

    // 품질 검증 설정
    this.qualitySettings = {
      maxIterations: 3,           // 최대 수정 반복 횟수
      criticalScoreThreshold: 70, // 치명적 이슈로 간주할 점수 기준
      autoFixEnabled: true         // 자동 수정 활성화 여부
    };
  }

  /**
   * 초기화
   */
  async initialize() {
    await this.stateManager.initialize();
  }

  /**
   * 문서 자동 검증 및 수정 루프
   * Review Agent가 문제를 발견하면 Code Agent에게 자동으로 수정 요청
   * 최대 N회 반복하여 품질 기준을 통과할 때까지 수정
   */
  async validateAndFixDocuments(docs, maxIterations = 3) {
    console.log('\n🔄 자동 품질 검증 시작...');

    let currentDocs = { ...docs };
    let iteration = 0;
    let lastReviewResult = null;

    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n📋 검증 라운드 ${iteration}/${maxIterations}`);

      // Review Agent 검토
      const reviewResult = await this.reviewAgent.reviewDocuments(currentDocs);
      lastReviewResult = reviewResult;

      const score = Math.round(reviewResult.overall_score);
      console.log(`📊 품질 점수: ${score}/100`);

      // 치명적 이슈 수집
      const criticalIssues = this.collectCriticalIssues(reviewResult);

      if (criticalIssues.length === 0 && score >= this.qualitySettings.criticalScoreThreshold) {
        console.log('✅ 모든 품질 검증 통과!');
        return {
          success: true,
          documents: currentDocs,
          finalScore: score,
          iterations: iteration,
          reviewResult: reviewResult,
          message: `품질 검증 완료 (${iteration}회 반복, 점수: ${score}/100)`
        };
      }

      // 마지막 반복이면 더 이상 수정하지 않음
      if (iteration >= maxIterations) {
        console.log(`⚠️ 최대 반복 횟수 도달 (${maxIterations}회)`);
        console.log(`현재 점수: ${score}/100, 남은 이슈: ${criticalIssues.length}개`);
        break;
      }

      // 이슈 리포트
      console.log(`\n⚠️ 발견된 치명적 이슈: ${criticalIssues.length}개`);
      criticalIssues.slice(0, 5).forEach((issue, idx) => {
        console.log(`  ${idx + 1}. [${issue.severity}] ${issue.message}`);
      });

      // Code Agent에 자동 수정 요청
      console.log(`\n🔧 자동 수정 시작...`);
      const fixedDocs = await this.autoFixDocuments(currentDocs, criticalIssues, reviewResult);

      // 수정되었는지 확인
      if (JSON.stringify(fixedDocs) === JSON.stringify(currentDocs)) {
        console.log('⚠️ 문서가 수정되지 않았습니다. 반복 중단.');
        break;
      }

      currentDocs = fixedDocs;
      console.log('✅ 자동 수정 완료, 재검증 중...');
    }

    // 최종 결과
    return {
      success: lastReviewResult.overall_score >= this.qualitySettings.criticalScoreThreshold,
      documents: currentDocs,
      finalScore: Math.round(lastReviewResult.overall_score),
      iterations: iteration,
      reviewResult: lastReviewResult,
      message: lastReviewResult.overall_score >= this.qualitySettings.criticalScoreThreshold
        ? `품질 검증 통과 (${iteration}회 반복, 점수: ${Math.round(lastReviewResult.overall_score)}/100)`
        : `품질 검증 미완료 (${iteration}회 반복 후 점수: ${Math.round(lastReviewResult.overall_score)}/100)\n남은 이슈가 있지만 계속 진행합니다.`
    };
  }

  /**
   * 치명적 이슈 수집
   */
  collectCriticalIssues(reviewResult) {
    const criticalIssues = [];

    // 금지된 섹션 (가장 높은 우선순위)
    if (reviewResult.forbidden_sections) {
      criticalIssues.push(...reviewResult.forbidden_sections.map(issue => ({
        ...issue,
        priority: 'critical'
      })));
    }

    // 한글/영어 혼용 (높은 우선순위)
    if (reviewResult.language_issues) {
      criticalIssues.push(...reviewResult.language_issues.filter(issue =>
        issue.severity === 'high'
      ).map(issue => ({
        ...issue,
        priority: 'high'
      })));
    }

    // 마크다운 형식 오류 (중간 우선순위)
    if (reviewResult.markdown_issues) {
      criticalIssues.push(...reviewResult.markdown_issues.filter(issue =>
        issue.severity === 'high' || issue.severity === 'critical'
      ).map(issue => ({
        ...issue,
        priority: 'medium'
      })));
    }

    // 일반 이슈 중 높은 심각도
    if (reviewResult.issues) {
      criticalIssues.push(...reviewResult.issues.filter(issue =>
        issue.severity === 'high'
      ).map(issue => ({
        ...issue,
        priority: 'medium'
      })));
    }

    return criticalIssues;
  }

  /**
   * 문서 자동 수정
   */
  async autoFixDocuments(docs, criticalIssues, reviewResult) {
    const fixedDocs = { ...docs };

    // 파일별로 이슈 그룹화
    const issuesByFile = {};
    criticalIssues.forEach(issue => {
      const file = issue.file || Object.keys(docs)[0];
      if (!issuesByFile[file]) {
        issuesByFile[file] = [];
      }
      issuesByFile[file].push(issue);
    });

    // 각 파일 수정
    for (const [filename, fileIssues] of Object.entries(issuesByFile)) {
      if (!fixedDocs[filename]) continue;

      console.log(`  🔧 ${filename} 수정 중... (${fileIssues.length}개 이슈)`);

      let content = fixedDocs[filename];
      const originalLength = content.length;

      // 1. 금지된 섹션 제거 (헤딩 기반)
      const forbiddenIssues = fileIssues.filter(i => i.type === 'forbidden_section');
      if (forbiddenIssues.length > 0) {
        console.log(`    - 금지된 섹션 ${forbiddenIssues.length}개 제거`);
        forbiddenIssues.forEach(issue => {
          // 섹션 전체 제거 (헤딩부터 다음 헤딩 전까지 또는 --- 전까지)
          const escapedSection = this.escapeRegex(issue.section);
          const sectionPattern = new RegExp(
            `^#{1,6}\\s*.*${escapedSection}.*$[\\s\\S]*?(?=^#{1,6}\\s|^---|$)`,
            'im'
          );
          content = content.replace(sectionPattern, '');
        });
      }

      // 2. 금지된 본문 내용 제거 (볼드 텍스트 패턴)
      const forbiddenContentIssues = fileIssues.filter(i => i.type === 'forbidden_content');
      if (forbiddenContentIssues.length > 0) {
        console.log(`    - 금지된 내용 ${forbiddenContentIssues.length}개 제거`);
        // "**라이선스:** MIT" 같은 줄 전체 제거
        content = content.replace(/^\*\*(라이센스|라이선스|License)\*\*:.*$/gmi, '');
        content = content.replace(/^\*\*(문서\s*버전|Version|버전)\*\*:.*$/gmi, '');
        content = content.replace(/^\*\*(최종\s*업데이트|Last Updated|업데이트)\*\*:.*$/gmi, '');
        content = content.replace(/^\*\*(저장소|Repository)\*\*:.*$/gmi, '');
        content = content.replace(/^\*\*(이슈\s*트래커|Issue Tracker)\*\*:.*$/gmi, '');
        content = content.replace(/^\*\*(지원|문의|Contact)\*\*:.*$/gmi, '');
      }

      // 3. 가짜 GitHub URL 제거
      const fabricatedUrlIssues = fileIssues.filter(i => i.type === 'fabricated_url');
      if (fabricatedUrlIssues.length > 0) {
        console.log(`    - 가짜 GitHub URL ${fabricatedUrlIssues.length}개 제거`);
        content = content.replace(/https?:\/\/github\.com\/(example|user|project|repo|your-[a-zA-Z0-9_-]+)\/[a-zA-Z0-9_-]+[^\s]*/gi, '');
      }

      // 4. 글자수 제한 (7000자 초과 시 자동 압축)
      const tooLongIssues = fileIssues.filter(i => i.type === 'document_too_long');
      if (tooLongIssues.length > 0 && content.length > 7000) {
        console.log(`    - 문서 길이 압축 (${content.length}자 → 목표 7000자)`);
        content = this.compressDocument(content, 7000);
      }

      // 5. 들여쓰기 자동 적용
      content = this.applyIndentation(content);

      // 6. 마크다운 형식 자동 수정
      content = this.codeAgent.validateAndFixMarkdown(content, filename);

      // 7. 연속된 빈 줄 정리 (3개 이상 → 2개로)
      content = content.replace(/\n{3,}/g, '\n\n');

      const newLength = content.length;
      if (newLength !== originalLength) {
        console.log(`    ✅ 문서 길이: ${originalLength}자 → ${newLength}자`);
      }

      fixedDocs[filename] = content;
    }

    return fixedDocs;
  }

  /**
   * 문서 자동 압축 (7000자 이하로)
   */
  compressDocument(content, maxChars) {
    // 1. 과도한 예시 코드 블록을 blockquote로 변환
    content = content.replace(/```([a-z]*)\n([\s\S]{200,}?)```/g, (match, lang, code) => {
      if (code.length > 300) {
        const lines = code.split('\n');
        const compressed = lines.slice(0, Math.min(10, lines.length)).join('\n');
        return `> \`\`\`${lang}\n> ${compressed}\n> ... (생략)\n> \`\`\``;
      }
      return match;
    });

    // 2. 긴 리스트를 blockquote로 감싸기
    content = content.replace(/((?:^[-*]\s+.+$\n){5,})/gm, (match) => {
      const lines = match.trim().split('\n');
      return '> ' + lines.join('\n> ') + '\n';
    });

    // 3. 여전히 너무 길면 마지막 수단: 각 섹션을 잘라내기
    if (content.length > maxChars) {
      const sections = content.split(/^(#{1,6}\s+.+)$/gm);
      let compressed = '';
      let currentLength = 0;

      for (let i = 0; i < sections.length; i++) {
        if (currentLength + sections[i].length > maxChars) {
          compressed += '\n\n... (내용 생략)\n';
          break;
        }
        compressed += sections[i];
        currentLength += sections[i].length;
      }

      return compressed;
    }

    return content;
  }

  /**
   * 들여쓰기 자동 적용
   */
  applyIndentation(content) {
    // 중첩된 리스트에 자동 들여쓰기 적용 (2 spaces)
    const lines = content.split('\n');
    let indentLevel = 0;
    const indented = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 헤딩이나 코드 블록은 건드리지 않음
      if (line.match(/^#{1,6}\s/) || line.match(/^```/)) {
        indented.push(line);
        continue;
      }

      // 리스트 항목 감지
      if (line.match(/^[-*]\s/)) {
        // 이미 들여쓰기가 있으면 유지
        if (line.match(/^\s+[-*]\s/)) {
          indented.push(line);
        } else {
          // 최상위 리스트
          indented.push(line);
        }
      } else if (line.match(/^\s+[-*]\s/)) {
        // 이미 들여쓰기된 리스트 유지
        indented.push(line);
      } else {
        indented.push(line);
      }
    }

    return indented.join('\n');
  }

  /**
   * 정규식 이스케이프
   */
  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 대화 처리 (핵심 메서드)
   */
  async processConversation(userMessage, context = {}) {
    console.log('\n💬 사용자 메시지:', userMessage);

    // 의도 분석
    const intent = this.analyzeIntent(userMessage, context);

    console.log('🎯 감지된 의도:', intent.type);

    let response;

    switch (intent.type) {
      case 'request_requirements':
        response = await this.handleRequestRequirements(intent);
        break;

      case 'provide_requirements':
        response = await this.handleInitialAnalysis(intent);
        break;

      case 'initial_analysis':
        response = await this.handleInitialAnalysis(intent);
        break;

      case 'improve_document':
        response = await this.handleImproveDocument(intent);
        break;

      case 'generate_image':
        response = await this.handleGenerateImage(intent);
        break;

      case 'modify_prompt':
        response = await this.handleModifyPrompt(intent);
        break;

      case 'review_quality':
        response = await this.handleReviewQuality(intent);
        break;

      case 'download_notion':
        response = await this.handleDownloadNotion(intent);
        break;

      case 'update_notion':
        response = await this.handleUpdateNotion(intent);
        break;

      case 'show_status':
        response = await this.handleShowStatus(intent);
        break;

      case 'reset':
        response = await this.handleReset(intent);
        break;

      default:
        response = {
          success: false,
          message: '의도를 파악할 수 없습니다. 다시 말씀해주세요.',
          suggestions: [
            '프로젝트 문서화해줘',
            'API 문서 더 자세하게 해줘',
            '다이어그램 추가해줘',
            'Code Agent 프롬프트 수정해줘'
          ]
        };
    }

    // 대화 기록 저장
    this.stateManager.addConversation(userMessage, response);
    await this.stateManager.saveSession();

    return response;
  }

  /**
   * 의도 분석
   */
  analyzeIntent(message, context) {
    const msg = message.toLowerCase();

    // 대기 중인 요구사항이 있는 경우 - 현재 메시지를 요구사항으로 처리
    if (this.stateManager.hasPendingRequirements()) {
      return {
        type: 'provide_requirements',
        requirements: message,
        projectPath: context.projectPath || process.cwd()
      };
    }

    // 초기 분석 요청
    if (msg.includes('문서화') || msg.includes('분석') || msg.includes('요약') ||
        msg.includes('documentation') || msg.includes('summary')) {
      return {
        type: 'request_requirements',
        projectPath: context.projectPath || process.cwd()
      };
    }

    // 문서 개선
    if (msg.includes('더 자세') || msg.includes('개선') || msg.includes('수정') ||
        msg.includes('improve') || msg.includes('enhance') || msg.includes('상세')) {
      return {
        type: 'improve_document',
        target: this.extractTarget(message),
        improvement: this.extractImprovement(message)
      };
    }

    // 이미지/다이어그램 생성 (이제 모두 이미지로 처리)
    // 키워드: 이미지, 그림, 다이어그램, 플로우차트, 시퀀스, ERD 등
    // 예: "시스템 아키텍처 이미지 만들어줘", "플로우차트 그려줘", "ERD 다이어그램 생성"
    if (msg.includes('이미지') || msg.includes('image') ||
        msg.includes('그림') || msg.includes('picture') ||
        msg.includes('사진') || msg.includes('photo') ||
        msg.includes('일러스트') || msg.includes('illustration') ||
        msg.includes('아이콘') || msg.includes('icon') ||
        msg.includes('다이어그램') || msg.includes('diagram') ||
        msg.includes('플로우차트') || msg.includes('flowchart') ||
        msg.includes('시퀀스') || msg.includes('sequence') ||
        msg.includes('erd') || msg.includes('구조도') ||
        msg.includes('시각화') || msg.includes('차트')) {

      // 모두 이미지 생성으로 통합 (Mermaid 제거)
      return {
        type: 'generate_image',
        imageType: this.extractImageType(message),
        description: message,
        target: this.extractTarget(message)
      };
    }

    // 프롬프트 수정
    if (msg.includes('프롬프트') || msg.includes('prompt') ||
        (msg.includes('agent') && (msg.includes('수정') || msg.includes('modify')))) {
      return {
        type: 'modify_prompt',
        agentName: this.extractAgentName(message),
        modification: message
      };
    }

    // 품질 검토
    if (msg.includes('검토') || msg.includes('review') || msg.includes('품질') ||
        msg.includes('체크') || msg.includes('확인')) {
      return {
        type: 'review_quality'
      };
    }

    // Notion 다운로드 (Notion → Markdown)
    if (msg.trim() === '/notion_download' || msg === '/notion_download') {
      return {
        type: 'download_notion'
      };
    }

    // Notion 업데이트 (Markdown → Notion)
    if (msg.trim() === '/notion_update' || msg === '/notion_update') {
      return {
        type: 'update_notion'
      };
    }

    // 상태 확인
    if (msg.includes('상태') || msg.includes('status') || msg.includes('현재')) {
      return {
        type: 'show_status'
      };
    }

    // 리셋
    if (msg.includes('리셋') || msg.includes('reset') || msg.includes('초기화')) {
      return {
        type: 'reset'
      };
    }

    return { type: 'unknown' };
  }

  /**
   * 요구사항 입력 요청 처리
   */
  async handleRequestRequirements(intent) {
    console.log('\n📋 요구사항 입력 대기 중...');

    // 프로젝트 설정
    this.stateManager.setProject(intent.projectPath);

    // pending 상태 저장
    this.stateManager.setPendingRequirements({
      projectPath: intent.projectPath,
      requestedAt: new Date().toISOString()
    });

    await this.stateManager.saveSession();

    return {
      success: true,
      message: '프로젝트 문서화를 시작합니다.',
      requirementsPrompt: '문서화에 대한 요구사항을 입력해주세요.\n\n예시:\n  - "API 문서를 상세하게 작성해주세요"\n  - "보안 관련 내용을 중점적으로 작성해주세요"\n  - "초보자도 이해할 수 있도록 쉽게 작성해주세요"\n  - "특별한 요구사항 없습니다" (기본 문서화)\n\n요구사항을 입력해주세요:'
    };
  }

  /**
   * 초기 분석 처리
   */
  async handleInitialAnalysis(intent) {
    // 요구사항 확인
    const requirements = intent.requirements || null;

    if (requirements) {
      console.log(`\n📋 요구사항: ${requirements}`);
    }

    console.log('\n📝 Step 1/4: 프로젝트 코드 분석...');

    // 프로젝트 설정
    const projectPath = intent.projectPath || this.stateManager.state.projectPath || process.cwd();
    this.stateManager.setProject(projectPath);

    // 코드 분석 (요구사항 전달)
    const codeResult = await this.codeAgent.generateDocs(projectPath, {
      requirements: requirements
    });

    // 문서 저장 (상태에)
    Object.entries(codeResult.files).forEach(([filename, content]) => {
      this.stateManager.setDocument(filename, content);
    });

    console.log(`✅ ${Object.keys(codeResult.files).length}개 문서 생성 완료`);

    // 자동 품질 검증 및 수정 루프
    console.log('\n🔍 Step 2/4: 자동 품질 검증 및 수정...');
    const validationResult = await this.validateAndFixDocuments(
      codeResult.files,
      this.qualitySettings.maxIterations
    );

    console.log(`\n${validationResult.message}`);

    // 검증된 문서로 교체
    const finalDocs = validationResult.documents;

    // StateManager에 최종 문서 저장
    Object.entries(finalDocs).forEach(([filename, content]) => {
      this.stateManager.setDocument(filename, content);
    });

    // 검증 결과 요약
    const reviewSummary = this.generateReviewSummary(validationResult.reviewResult);
    console.log(reviewSummary);

    // 이미지 자동 생성 (SVG 다이어그램 생성 및 문서 삽입)
    console.log('\n🎨 Step 3/4: 이미지 자동 생성...');
    const imageResult = await this.imageAgent.generateImagesForDocuments(finalDocs);

    if (imageResult.images && imageResult.images.length > 0) {
      console.log(`✅ ${imageResult.images.length}개 이미지 생성 완료`);

      // 생성된 이미지를 문서에 자동 삽입
      imageResult.images.forEach((img, idx) => {
        console.log(`   ${idx + 1}. ${img.title} (${img.filename})`);

        // 문서에 이미지 삽입
        if (img.targetFile && finalDocs[img.targetFile]) {
          const imageMarkdown = `\n\n![${img.title}](${img.relativePath})\n\n`;

          // 해당 섹션 바로 다음에 이미지 삽입
          if (img.section) {
            const sectionRegex = new RegExp(`(#{1,6}\\s+.*${this.escapeRegex(img.section)}.*$)`, 'im');
            finalDocs[img.targetFile] = finalDocs[img.targetFile].replace(
              sectionRegex,
              `$1${imageMarkdown}`
            );
          } else {
            // 섹션을 찾을 수 없으면 문서 끝에 추가
            finalDocs[img.targetFile] += imageMarkdown;
          }

          // StateManager에 업데이트된 문서 저장
          this.stateManager.setDocument(img.targetFile, finalDocs[img.targetFile]);
        }
      });

      console.log('\n✅ 이미지가 문서에 자동으로 삽입되었습니다.');
      console.log(`   저장 위치: ./generated-images/`);
    } else {
      console.log('ℹ️  생성할 이미지가 없습니다.');
    }

    // Notion 페이지 자동 생성 (품질 검증 통과한 문서만)
    console.log('\n📄 Step 4/5: Notion 자동 업로드 중...');
    const notionResult = await this.notionAgent.createNotionPages(finalDocs, {
      parentPageId: this.config.notionParentPageId
    });

    let notionSummary = '';
    if (notionResult.success) {
      // Notion 페이지 ID 저장
      notionResult.pages.forEach(page => {
        const filename = this.findFilenameFromTitle(page.title);
        this.stateManager.setNotionPage(filename, page.id, page.url);
      });
      console.log(`✅ ${notionResult.pages.length}개 Notion 페이지 자동 업로드 완료`);

      // 페이지 링크 정리
      const pageLinks = notionResult.pages.map(p => `  - ${p.title}: ${p.url}`).join('\n');
      notionSummary = `\n\n📍 Notion 페이지 (자동 업로드됨):\n${pageLinks}`;
    } else if (notionResult.simulation) {
      // Simulation 모드 (API 키 없음)
      console.log('ℹ️  Notion API 키가 없어 시뮬레이션 모드로 실행됨');
      notionSummary = '\n\n⚠️  Notion 업로드 생략 (API 키 미설정)\n' +
        '  → .env 파일에 NOTION_API_KEY 설정 후 다시 시도하세요.';
    } else {
      // 업로드 실패
      console.error('❌ Notion 업로드 실패:', notionResult.error);
      notionSummary = `\n\n❌ Notion 업로드 실패: ${notionResult.error}\n` +
        '  → /notion_update 명령으로 수동 업로드 가능합니다.';
    }

    // 요구사항 처리 완료 - pending 상태 초기화
    this.stateManager.clearPendingRequirements();

    await this.stateManager.saveSession();

    return {
      success: true,
      message: '✅ 프로젝트 문서화가 완료되었습니다!' + notionSummary,
      summary: {
        documents: Object.keys(finalDocs),
        qualityScore: validationResult.finalScore,
        validationIterations: validationResult.iterations,
        imagePrompts: imageResult.images?.length || 0,
        notionPages: notionResult.pages?.length || 0,
        notionUploaded: notionResult.success || false
      },
      imagePrompts: imageResult.images || [],
      validationResult: {
        score: validationResult.finalScore,
        iterations: validationResult.iterations,
        issues: validationResult.reviewResult.forbidden_sections?.length || 0 +
                validationResult.reviewResult.language_issues?.length || 0 +
                validationResult.reviewResult.markdown_issues?.length || 0
      },
      notionPages: notionResult.pages,
      requirements: requirements || '기본 요구사항',
      nextSteps: [
        '문서를 개선하려면: "API 문서 더 자세하게 해줘"',
        imageResult.images?.length > 0
          ? `이미지 생성: IMAGE_PROMPTS.md 파일의 프롬프트를 사용하여 ${imageResult.images.length}개 이미지 생성`
          : '이미지 추가하려면: "시스템 아키텍처 이미지 만들어줘"',
        'Agent 수정하려면: "Code Agent가 보안도 체크하게 해줘"'
      ]
    };
  }

  /**
   * Review 결과 요약 생성
   */
  generateReviewSummary(reviewResult) {
    const lines = [];

    if (reviewResult.forbidden_sections && reviewResult.forbidden_sections.length > 0) {
      lines.push(`  ⚠️ 금지된 섹션: ${reviewResult.forbidden_sections.length}개 발견 및 제거`);
    }

    if (reviewResult.language_issues && reviewResult.language_issues.length > 0) {
      lines.push(`  ⚠️ 언어 혼용: ${reviewResult.language_issues.length}개 발견`);
    }

    if (reviewResult.markdown_issues && reviewResult.markdown_issues.length > 0) {
      lines.push(`  ✅ 마크다운 형식: ${reviewResult.markdown_issues.length}개 수정`);
    }

    if (lines.length === 0) {
      return '  ✅ 모든 검증 항목 통과!';
    }

    return lines.join('\n');
  }

  /**
   * 이미지 프롬프트 요약 포맷팅
   */
  formatImagePromptsSummary(images) {
    let content = `# 이미지 생성 프롬프트\n\n`;
    content += `> **자동 생성된 이미지 프롬프트 목록**\n`;
    content += `> 각 프롬프트를 DALL-E, Midjourney, Leonardo.ai 등에 붙여넣어 이미지를 생성하세요.\n\n`;
    content += `---\n\n`;

    images.forEach((img, idx) => {
      content += `## ${idx + 1}. ${img.title}\n\n`;
      content += `**타입:** ${img.type}  \n`;
      content += `**대상 문서:** ${img.targetFile}  \n`;
      content += `**섹션:** ${img.section}\n\n`;

      content += `### 이미지 생성 프롬프트\n\n`;
      content += `\`\`\`\n${img.prompt}\n\`\`\`\n\n`;

      content += `**사용 방법:**\n`;
      content += `1. 위 프롬프트 전체를 복사\n`;
      content += `2. AI 이미지 생성 도구에 붙여넣기 (DALL-E 3, Midjourney, Leonardo.ai)\n`;
      content += `3. 생성된 이미지를 다운로드\n`;
      content += `4. \`${img.targetFile}\`의 "${img.section}" 섹션에 삽입\n\n`;

      content += `---\n\n`;
    });

    content += `## 💡 추천 이미지 생성 도구\n\n`;
    content += `- **DALL-E 3** (OpenAI): 가장 정확하고 깔끔한 결과\n`;
    content += `- **Midjourney**: 예술적이고 세련된 스타일\n`;
    content += `- **Leonardo.ai**: 무료이며 커스터마이징 가능\n`;
    content += `- **Stable Diffusion**: 로컬 실행 가능, 완전 무료\n\n`;

    content += `## 🎨 스타일 가이드\n\n`;
    content += `모든 이미지는 다음 스타일로 생성됩니다:\n`;
    content += `- **색상:** 어두운 색 (검은색, 진한 회색, 네이비)\n`;
    content += `- **채도:** 낮은 채도, 차분한 톤\n`;
    content += `- **디자인:** 미니멀, 깔끔, 플랫 디자인\n`;
    content += `- **배경:** 어두운 배경 또는 투명\n`;
    content += `- **텍스트:** 흰색 또는 밝은 회색\n\n`;

    return content;
  }

  /**
   * 문서 개선 처리 (Code Agent에 위임)
   */
  async handleImproveDocument(intent) {
    console.log(`\n📝 문서 개선 중: ${intent.target || '전체'}`);

    const currentDocs = this.stateManager.getAllDocuments();

    if (Object.keys(currentDocs).length === 0) {
      return {
        success: false,
        message: '아직 생성된 문서가 없습니다. 먼저 "프로젝트 문서화해줘"를 실행하세요.'
      };
    }

    // 특정 문서만 개선할지 결정
    const targetFile = intent.target ? this.matchFilename(intent.target) : null;
    const document = targetFile ? this.stateManager.getDocument(targetFile) : null;

    if (targetFile && !document) {
      return {
        success: false,
        message: `문서를 찾을 수 없습니다: ${targetFile}`
      };
    }

    // Code Agent에 위임
    const result = await this.codeAgent.improveDocument(document, intent.improvement);

    if (result.success) {
      // StateManager 업데이트
      this.stateManager.setDocument(targetFile, result.document);

      // Notion 동기화 (Notion Agent에 위임)
      const syncResult = await this.notionAgent.syncToNotion(
        { [targetFile]: result.document },
        this.stateManager,
        { updateMode: 'efficient' }
      );

      await this.stateManager.saveSession();

      return {
        success: true,
        message: `${targetFile} 문서가 개선되었습니다.`,
        updated: [targetFile],
        notionUpdated: syncResult.successCount
      };
    }

    return result;
  }

  /**
   * 이미지 프롬프트 생성 처리 (Image Agent에 위임)
   *
   * Image Agent는 더 이상 실제 이미지를 생성하지 않고,
   * 사용자가 DALL-E, Midjourney 등에서 사용할 수 있는
   * 상세한 영문 프롬프트만 생성합니다.
   *
   * 사용자는 생성된 프롬프트를 복사하여 원하는 AI 이미지 생성 도구에서 사용합니다.
   */
  async handleGenerateImage(intent) {
    console.log(`\n🖼️ 이미지 프롬프트 생성 중: ${intent.imageType || 'technical'}`);

    // Image Agent에 위임 (프롬프트만 생성)
    const result = await this.imageAgent.generateImagePrompt({
      type: intent.imageType || 'technical',
      title: intent.description || '시스템 다이어그램',
      description: intent.description,
      style: 'professional technical'
    });

    if (result.success) {
      console.log('\n✅ 이미지 프롬프트 생성 완료');
      console.log(result.formattedOutput);

      return {
        success: true,
        message: '이미지 생성 프롬프트가 준비되었습니다.',
        prompt: result.formattedOutput,
        instructions: result.instructions,
        type: result.type
      };
    }

    return result;
  }

  /**
   * 다이어그램 추가 처리 (제거됨 - 이제 이미지로만 처리)
   *
   * ❌ 더 이상 Mermaid 다이어그램을 사용하지 않습니다.
   * ✅ 대신 handleGenerateImage()를 사용하세요.
   */
  async handleAddDiagram(intent) {
    // Mermaid 다이어그램 기능 제거됨
    return {
      success: false,
      message: '⚠️ Mermaid 다이어그램 기능이 제거되었습니다.\n\n대신 "다이어그램 이미지 만들어줘"를 사용하여 Image Agent로 이미지를 생성하세요.'
    };
  }

  /**
   * 프롬프트 수정 처리
   */
  async handleModifyPrompt(intent) {
    console.log(`\n⚙️ 프롬프트 수정 중: ${intent.agentName || 'unknown'}`);

    const result = await this.promptAgent.modifyPrompt({
      agentName: intent.agentName,
      userRequest: intent.modification
    });

    return result;
  }

  /**
   * 품질 검토 처리
   */
  async handleReviewQuality(intent) {
    console.log('\n🔍 문서 품질 검토 중...');

    const docs = this.stateManager.getAllDocuments();

    if (Object.keys(docs).length === 0) {
      return {
        success: false,
        message: '검토할 문서가 없습니다.'
      };
    }

    const reviewResult = await this.reviewAgent.reviewDocuments(docs);
    const report = this.reviewAgent.generateReport(reviewResult);

    return {
      success: true,
      message: '품질 검토가 완료되었습니다.',
      report,
      score: Math.round(reviewResult.overall_score),
      issues: reviewResult.issues,
      improvements: reviewResult.improvements
    };
  }

  /**
   * Notion 다운로드 처리 (Notion Agent에 위임)
   */
  async handleDownloadNotion(intent) {
    console.log('\n📥 Notion → Markdown 다운로드 시작...');

    const notionPages = this.stateManager.getAllNotionPages();

    if (Object.keys(notionPages).length === 0) {
      return {
        success: false,
        message: 'Notion 페이지가 없습니다. 먼저 문서를 Notion에 업로드하세요.'
      };
    }

    // Notion Agent에 위임
    const filenames = Object.keys(notionPages);
    const result = await this.notionAgent.syncFromNotion(filenames, this.stateManager);

    if (result.success) {
      // modifiedFiles 초기화 (Notion에서 가져온 것이므로)
      this.stateManager.clearModifiedFiles();
      await this.stateManager.saveSession();

      const summary = result.results.map(r =>
        r.success
          ? `  ✓ ${r.filename}: ${r.blocksCount}개 블록`
          : `  ✗ ${r.filename}: 실패`
      ).join('\n');

      return {
        success: true,
        message: `✅ Notion → Markdown 동기화 완료!\n\n${summary}`,
        successCount: result.successCount,
        failCount: result.failCount
      };
    }

    return result;
  }

  /**
   * Notion 업데이트 처리 (Notion Agent에 위임)
   */
  async handleUpdateNotion(intent) {
    console.log('\n📤 Markdown → Notion 업로드 시작...');

    const notionPages = this.stateManager.getAllNotionPages();

    if (Object.keys(notionPages).length === 0) {
      return {
        success: false,
        message: 'Notion 페이지가 없습니다. 먼저 문서를 Notion에 업로드하세요.'
      };
    }

    // 수정된 파일 확인
    console.log('\n📝 수정된 파일 확인...');
    const modifiedFiles = this.stateManager.getModifiedFiles();

    if (modifiedFiles.length === 0) {
      return {
        success: true,
        message: '✅ 수정할 파일이 없습니다.\n\nℹ️  Notion에서 수정한 내용을 가져오려면 /notion_download를 사용하세요.'
      };
    }

    // 수정된 파일만 동기화
    const docs = this.stateManager.getAllDocuments();
    const modifiedDocs = {};
    modifiedFiles.forEach(filename => {
      if (docs[filename]) {
        modifiedDocs[filename] = docs[filename];
      }
    });

    console.log(`\n📤 ${modifiedFiles.length}개 파일 Notion에 업로드 중...\n`);

    // Notion Agent에 위임
    const result = await this.notionAgent.syncToNotion(
      modifiedDocs,
      this.stateManager,
      { updateMode: 'efficient' }
    );

    if (result.success) {
      // 업데이트 성공 시 수정된 파일 목록 초기화
      this.stateManager.clearModifiedFiles();
      await this.stateManager.saveSession();

      const pageLinks = result.results
        .filter(r => r.success)
        .map(r => `  - ${r.filename}`)
        .join('\n');

      const summary = [
        `\n✅ Notion 동기화 완료!`,
        ``,
        `📊 업데이트 통계:`,
        `  - 처리된 페이지: ${result.results.length}개`,
        `  - 성공: ${result.successCount}개`,
        `  - 실패: ${result.failCount}개`,
        ``,
        `📍 업데이트된 페이지:`,
        pageLinks
      ].join('\n');

      return {
        success: true,
        message: summary,
        updated: result.successCount,
        failed: result.failCount
      };
    }

    return result;
  }

  /**
   * 상태 확인 처리
   */
  async handleShowStatus(intent) {
    const summary = this.stateManager.getSummary();
    const prompts = this.promptAgent.listPrompts();

    return {
      success: true,
      message: '현재 상태입니다.',
      state: {
        ...summary,
        customPrompts: prompts
      }
    };
  }

  /**
   * 리셋 처리
   */
  async handleReset(intent) {
    await this.stateManager.reset();

    return {
      success: true,
      message: '세션이 초기화되었습니다. 새로 시작할 수 있습니다.'
    };
  }

  // === 유틸리티 함수 ===

  extractTarget(message) {
    const msgLower = message.toLowerCase();

    // 문서 키워드 매칭
    const keywords = {
      'readme': ['readme', '개요', 'overview'],
      'architecture': ['architecture', '아키텍처', '구조'],
      'api': ['api', 'endpoint', '엔드포인트'],
      'database': ['database', '데이터베이스', 'db', '스키마'],
      'setup': ['setup', '설정', '환경'],
      'test': ['test', '테스트'],
      'deploy': ['deploy', '배포']
    };

    for (const [type, terms] of Object.entries(keywords)) {
      for (const term of terms) {
        if (msgLower.includes(term)) {
          // 실제 문서 이름 찾기
          return this.matchFilename(type);
        }
      }
    }

    return null;
  }

  extractImprovement(message) {
    // "더 자세하게", "예시 추가", "보안 체크" 등 추출
    return message;
  }

  /**
   * 이미지 타입 추출 (Gemini API로 생성할 실제 이미지)
   *
   * 사용자가 어떤 종류의 이미지를 원하는지 파악
   * - architecture: 아키텍처 그림
   * - ui-mockup: UI 디자인 목업
   * - infographic: 인포그래픽
   *
   * ⚠️ 주의: 이것은 Gemini가 실제로 그릴 이미지 타입입니다.
   * Mermaid 다이어그램 타입과는 다릅니다!
   */
  extractImageType(message) {
    const types = {
      '아키텍처': 'architecture',
      'architecture': 'architecture',
      'ui': 'ui-mockup',
      '목업': 'ui-mockup',
      'mockup': 'ui-mockup',
      '인포그래픽': 'infographic',
      'infographic': 'infographic',
      '로고': 'logo',
      'logo': 'logo',
      '아이콘': 'icon',
      'icon': 'icon'
    };

    const msg = message.toLowerCase();
    for (const [key, type] of Object.entries(types)) {
      if (msg.includes(key)) {
        return type;
      }
    }

    return 'architecture';
  }

  /**
   * 다이어그램 타입 추출 (이미지 기반으로 변경)
   *
   * 사용자가 어떤 종류의 다이어그램 이미지를 원하는지 파악
   * - architecture: 시스템 아키텍처
   * - flowchart: 플로우차트
   * - sequence: 시퀀스 다이어그램
   * - erd: ERD (데이터베이스 관계도)
   * - technical: 기술 다이어그램 (일반)
   */
  extractDiagramType(message) {
    const types = {
      '시퀀스': 'sequence',
      'sequence': 'sequence',
      '플로우': 'flowchart',
      'flowchart': 'flowchart',
      'flow': 'flowchart',
      'erd': 'erd',
      '테이블': 'erd',
      '데이터베이스': 'erd',
      '아키텍처': 'architecture',
      'architecture': 'architecture',
      '구조도': 'architecture',
      '시스템': 'architecture'
    };

    const msg = message.toLowerCase();
    for (const [key, type] of Object.entries(types)) {
      if (msg.includes(key)) {
        return type;
      }
    }

    return 'technical'; // 기본값: 기술 다이어그램
  }

  extractAgentName(message) {
    const agents = ['code', 'review', 'notion', 'image', '코드', '리뷰', '노션', '이미지'];
    const msg = message.toLowerCase();

    for (const agent of agents) {
      if (msg.includes(agent)) {
        return agent;
      }
    }

    return 'code';
  }

  matchFilename(target) {
    const normalized = target.toLowerCase().replace('.md', '');

    // 모든 문서에서 키워드 매칭
    const docs = this.stateManager.getAllDocuments();
    const docNames = Object.keys(docs);

    for (const docName of docNames) {
      const docLower = docName.toLowerCase();
      if (docLower.includes(normalized) ||
          (normalized.includes('readme') && docLower.includes('개요')) ||
          (normalized.includes('개요') && docLower.includes('readme')) ||
          (normalized.includes('architecture') && docLower.includes('아키텍처')) ||
          (normalized.includes('아키텍처') && docLower.includes('architecture')) ||
          (normalized.includes('api') && docLower.includes('api')) ||
          (normalized.includes('database') && docLower.includes('데이터베이스')) ||
          (normalized.includes('데이터베이스') && docLower.includes('database')) ||
          (normalized.includes('setup') && docLower.includes('설정')) ||
          (normalized.includes('설정') && docLower.includes('setup'))) {
        return docName;
      }
    }

    // 매칭 실패 시 그대로 반환
    return `${target}.md`;
  }

  findFilenameFromTitle(title) {
    const docs = this.stateManager.getAllDocuments();
    const docNames = Object.keys(docs);

    // 제목으로 문서 매칭
    for (const docName of docNames) {
      const docTitle = this.extractTitleFromContent(docs[docName]);
      if (title.includes(docTitle) || docTitle.includes(title)) {
        return docName;
      }
    }

    // 키워드 매칭
    const titleLower = title.toLowerCase();
    for (const docName of docNames) {
      const docLower = docName.toLowerCase();
      if ((titleLower.includes('readme') || titleLower.includes('개요')) &&
          (docLower.includes('readme') || docLower.includes('개요'))) return docName;
      if ((titleLower.includes('architecture') || titleLower.includes('아키텍처')) &&
          (docLower.includes('architecture') || docLower.includes('아키텍처'))) return docName;
      if (titleLower.includes('api') && docLower.includes('api')) return docName;
      if ((titleLower.includes('database') || titleLower.includes('데이터베이스')) &&
          (docLower.includes('database') || docLower.includes('데이터베이스'))) return docName;
      if ((titleLower.includes('setup') || titleLower.includes('설정')) &&
          (docLower.includes('setup') || docLower.includes('설정'))) return docName;
    }

    // 첫 번째 문서 반환 (fallback)
    return docNames[0] || 'README.md';
  }

  extractTitleFromContent(content) {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1] : '';
  }

  /**
   * insertDiagramsIntoDoc - 제거됨 (Mermaid 다이어그램 기능 제거)
   */
  insertDiagramsIntoDoc(doc, diagrams) {
    // Mermaid 다이어그램 기능 제거됨
    console.warn('[Orchestrator] insertDiagramsIntoDoc is deprecated - Mermaid diagrams removed');
    return doc;
  }
}
