/**
 * Review Agent: 문서 품질 검토 및 개선 제안
 */

export class ReviewAgent {
  constructor(stateManager = null) {
    this.stateManager = stateManager;
    this.criteria = {
      completeness: { weight: 0.3, name: '완성도' },
      accuracy: { weight: 0.25, name: '정확성' },
      readability: { weight: 0.25, name: '가독성' },
      visualization: { weight: 0.1, name: '시각화' },
      consistency: { weight: 0.1, name: '일관성' }
    };
  }

  /**
   * 문서 품질 검토
   */
  async reviewDocuments(docs) {
    console.log('[Review Agent] 문서 검토 시작...');

    const results = {
      overall_score: 0,
      category_scores: {},
      issues: [],
      improvements: [],
      missing_diagrams: [],
      strengths: [],
      language_issues: [],      // 한글/영어 혼용 이슈
      markdown_issues: [],      // 마크다운 형식 이슈
      forbidden_sections: []    // 금지된 섹션 (버전, 라이센스 등)
    };

    // 각 카테고리별 점수 계산
    for (const [category, config] of Object.entries(this.criteria)) {
      const score = await this.evaluateCategory(category, docs);
      results.category_scores[category] = {
        score,
        weight: config.weight,
        name: config.name
      };
      results.overall_score += score * config.weight;
    }

    // 이슈 및 개선사항 수집
    results.issues = await this.findIssues(docs);
    results.improvements = await this.suggestImprovements(docs);
    results.missing_diagrams = await this.findMissingDiagrams(docs);
    results.strengths = await this.identifyStrengths(docs);

    // 신규: 언어 혼용 검사
    results.language_issues = await this.checkLanguageMixing(docs);

    // 신규: 마크다운 형식 검증
    results.markdown_issues = await this.checkMarkdownFormat(docs);

    // 신규: 금지된 섹션 검사
    results.forbidden_sections = await this.checkForbiddenSections(docs);

    // 치명적 이슈가 있으면 점수 대폭 감점
    if (results.language_issues.length > 0) {
      results.overall_score -= results.language_issues.length * 5;
    }
    if (results.forbidden_sections.length > 0) {
      results.overall_score -= results.forbidden_sections.length * 10;
    }
    if (results.markdown_issues.length > 0) {
      results.overall_score -= results.markdown_issues.length * 3;
    }

    results.overall_score = Math.max(0, results.overall_score);

    return results;
  }

  /**
   * 한글/영어 혼용 검사 (신규)
   */
  async checkLanguageMixing(docs) {
    const issues = [];

    for (const [filename, content] of Object.entries(docs)) {
      // 코드 블록과 인라인 코드 제거
      const withoutCode = content
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]+`/g, '');

      // 한글 문장 내에서 영어 문장이 섞인 패턴 찾기
      // 패턴: "한글 문장 English sentence in the middle 계속 한글"
      const mixedPatterns = [
        // "한글입니다 This is English 계속 한글"
        /[가-힣]{3,}[\s\S]{0,30}[A-Z][a-z]{3,}\s+[a-z]{3,}[\s\S]{0,30}[가-힣]{3,}/g,
        // "이것은 provides data to the system"
        /[가-힣]{2,}\s+(provides|returns|contains|includes|supports|enables|allows|creates|generates|processes)\s+[a-z]/gi
      ];

      mixedPatterns.forEach((pattern, index) => {
        const matches = withoutCode.match(pattern);
        if (matches && matches.length > 0) {
          matches.forEach(match => {
            issues.push({
              file: filename,
              severity: 'high',
              type: 'language_mixing',
              message: '한글 문장 내에 영어 문장 혼용 발견',
              example: match.substring(0, 100) + '...',
              suggestion: '한글로 완전히 번역하거나 기술 용어만 영어로 유지하세요'
            });
          });
        }
      });

      // 헤딩에서 영어와 한글 혼용 검사
      const headings = content.match(/^#{1,6}\s+.+$/gm) || [];
      headings.forEach(heading => {
        const hasKorean = /[가-힣]/.test(heading);
        const hasEnglish = /[A-Z][a-z]{3,}/.test(heading); // 단어 형태의 영어

        if (hasKorean && hasEnglish) {
          // 기술 용어는 허용 (API, REST, HTTP 등)
          const techTermsRemoved = heading.replace(/\b(API|REST|HTTP|JSON|XML|SQL|DB|URL|URI|ID|UI|UX|CSS|HTML|JWT)\b/g, '');
          const stillHasMixing = /[가-힣]/.test(techTermsRemoved) && /[A-Z][a-z]{3,}/.test(techTermsRemoved);

          if (stillHasMixing) {
            issues.push({
              file: filename,
              severity: 'medium',
              type: 'heading_mixing',
              message: '헤딩에서 한글과 영어 단어 혼용',
              example: heading,
              suggestion: '헤딩은 한글로 통일하세요 (기술 용어 제외)'
            });
          }
        }
      });
    }

    return issues;
  }

  /**
   * 마크다운 형식 검증 (신규)
   */
  async checkMarkdownFormat(docs) {
    const issues = [];

    for (const [filename, content] of Object.entries(docs)) {
      // 1. 헤딩 형식 검증 (### 뒤 공백 없음)
      const badHeadings = content.match(/^#{1,6}[^\s#]/gm);
      if (badHeadings) {
        issues.push({
          file: filename,
          severity: 'high',
          type: 'heading_format',
          message: `헤딩 형식 오류: ${badHeadings.length}개 (# 뒤 공백 없음)`,
          examples: badHeadings.slice(0, 3),
          suggestion: '헤딩 뒤에 공백을 추가하세요: "### 제목" (not "###제목")'
        });
      }

      // 2. 코드 블록 짝 맞추기
      const codeBlockCount = (content.match(/```/g) || []).length;
      if (codeBlockCount % 2 !== 0) {
        issues.push({
          file: filename,
          severity: 'critical',
          type: 'code_block',
          message: '코드 블록이 제대로 닫히지 않음',
          suggestion: '모든 ``` 코드 블록을 ```로 닫아야 합니다'
        });
      }

      // 3. 목록 형식 검증 (- 뒤 공백)
      const badLists = content.match(/^-[^\s-]/gm);
      if (badLists) {
        issues.push({
          file: filename,
          severity: 'medium',
          type: 'list_format',
          message: `목록 형식 오류: ${badLists.length}개`,
          examples: badLists.slice(0, 3),
          suggestion: '목록 항목은 "- 항목" 형식으로 작성 (- 뒤 공백 필요)'
        });
      }

      // 4. 연속된 빈 줄 (4개 이상)
      const excessiveBlankLines = content.match(/\n{4,}/g);
      if (excessiveBlankLines) {
        issues.push({
          file: filename,
          severity: 'low',
          type: 'blank_lines',
          message: `과도한 빈 줄: ${excessiveBlankLines.length}개 위치`,
          suggestion: '연속된 빈 줄은 2개 이하로 유지하세요'
        });
      }
    }

    return issues;
  }

  /**
   * 금지된 섹션 검사 (강화)
   */
  async checkForbiddenSections(docs) {
    const issues = [];

    // 금지된 키워드를 포함하는 모든 섹션 감지 (더 유연한 패턴)
    const forbiddenSections = [
      { pattern: /^#{1,6}\s*.*(라이센스|라이선스|License).*$/im, name: '라이센스' },
      { pattern: /^#{1,6}\s*.*(버전|Version).*$/im, name: '버전 정보' },
      { pattern: /^#{1,6}\s*.*(최종 업데이트|Last Updated|업데이트|Update).*$/im, name: '최종 업데이트' },
      { pattern: /^#{1,6}\s*.*(지원|문의|Support|Contact|연락처).*$/im, name: '지원/문의' },
      { pattern: /^#{1,6}\s*.*(기여|Contributing).*$/im, name: '기여 가이드' },
      { pattern: /^#{1,6}\s*.*(변경.*내역|Changelog|Release Notes).*$/im, name: '변경 내역' }
    ];

    for (const [filename, content] of Object.entries(docs)) {
      forbiddenSections.forEach(({ pattern, name }) => {
        const match = content.match(pattern);
        if (match) {
          issues.push({
            file: filename,
            severity: 'critical',
            type: 'forbidden_section',
            section: name,
            message: `금지된 섹션 발견: "${name}"`,
            example: match[0],
            suggestion: `"${name}" 섹션을 제거하세요 (사용자 요구사항: 관련 없는 주제 제외)`
          });
        }
      });

      // GitHub URL 패턴 검사 (fabricated URLs)
      const githubUrls = content.match(/github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+/g);
      if (githubUrls) {
        githubUrls.forEach(url => {
          // 실제 프로젝트 URL이 아닌 예시 URL 감지
          if (url.includes('example') || url.includes('user') || url.includes('project') || url.includes('repo') || url.includes('your-')) {
            issues.push({
              file: filename,
              severity: 'critical',
              type: 'fabricated_url',
              message: '임의로 생성된 GitHub URL 발견',
              example: url,
              suggestion: '실제 프로젝트 URL이 아니면 제거하세요'
            });
          }
        });
      }

      // 본문 내 금지된 내용 패턴 검사 (헤딩이 아닌 일반 텍스트)
      const forbiddenContent = [
        { pattern: /\*\*(라이센스|라이선스|License)\*\*:/gi, name: '라이선스 정보' },
        { pattern: /\*\*(문서\s*버전|Version|버전)\*\*:/gi, name: '문서 버전' },
        { pattern: /\*\*(최종\s*업데이트|Last Updated|업데이트)\*\*:/gi, name: '최종 업데이트 날짜' },
        { pattern: /\*\*(저장소|Repository)\*\*:/gi, name: '저장소 URL' },
        { pattern: /\*\*(이슈\s*트래커|Issue Tracker)\*\*:/gi, name: '이슈 트래커' },
        { pattern: /\*\*(지원|문의|Contact)\*\*:/gi, name: '지원/문의 정보' }
      ];

      forbiddenContent.forEach(({ pattern, name }) => {
        const matches = content.match(pattern);
        if (matches) {
          matches.forEach(match => {
            issues.push({
              file: filename,
              severity: 'critical',
              type: 'forbidden_content',
              content: name,
              message: `금지된 내용 발견: "${name}"`,
              example: match,
              suggestion: `"${name}" 내용을 문서에서 완전히 제거하세요`
            });
          });
        }
      });

      // 글자수 제한 검증 (5000-7000자)
      const charCount = content.length;
      if (charCount > 7000) {
        issues.push({
          file: filename,
          severity: 'critical',
          type: 'document_too_long',
          message: `문서가 너무 깁니다: ${charCount}자 (최대 7000자)`,
          suggestion: `현재 ${charCount - 7000}자 초과. 불필요한 내용 제거 또는 blockquote(>) 사용으로 압축 필요`
        });
      } else if (charCount < 2000) {
        issues.push({
          file: filename,
          severity: 'medium',
          type: 'document_too_short',
          message: `문서가 너무 짧습니다: ${charCount}자 (권장 5000자 이상)`,
          suggestion: `더 상세한 설명 추가 권장`
        });
      }
    }

    return issues;
  }

  /**
   * 카테고리별 평가
   */
  async evaluateCategory(category, docs) {
    switch (category) {
      case 'completeness':
        return this.checkCompleteness(docs);
      case 'accuracy':
        return this.checkAccuracy(docs);
      case 'readability':
        return this.checkReadability(docs);
      case 'visualization':
        return this.checkVisualization(docs);
      case 'consistency':
        return this.checkConsistency(docs);
      default:
        return 0;
    }
  }

  /**
   * 완성도 체크
   */
  checkCompleteness(docs) {
    let score = 100;
    const requiredSections = {
      'README.md': ['개요', '시작', '설치', '사용법'],
      'ARCHITECTURE.md': ['아키텍처', '구조', '컴포넌트', '흐름'],
      'API.md': ['엔드포인트', 'API', '요청', '응답'],
      'SETUP.md': ['설치', '설정', '환경', '실행']
    };

    for (const [filename, sections] of Object.entries(requiredSections)) {
      const content = docs[filename] || '';
      const foundSections = sections.filter(section =>
        content.toLowerCase().includes(section.toLowerCase())
      );

      if (foundSections.length === 0) {
        score -= 20; // 파일이 없거나 섹션이 없으면 큰 감점
      } else if (foundSections.length < sections.length) {
        score -= (sections.length - foundSections.length) * 5;
      }
    }

    return Math.max(0, score);
  }

  /**
   * 정확성 체크
   */
  checkAccuracy(docs) {
    let score = 100;
    const issues = [];

    for (const [filename, content] of Object.entries(docs)) {
      // 코드 블록 검증
      const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
      codeBlocks.forEach(block => {
        // 언어 지정 확인
        if (!block.match(/```\w+/)) {
          score -= 2;
          issues.push(`${filename}: 코드 블록에 언어 지정 누락`);
        }
      });

      // TODO/FIXME 체크
      if (content.includes('TODO') || content.includes('FIXME')) {
        score -= 5;
        issues.push(`${filename}: 미완성 표시(TODO/FIXME) 발견`);
      }

      // 깨진 링크 체크 (간단한 버전)
      const links = content.match(/\[.*?\]\((.*?)\)/g) || [];
      links.forEach(link => {
        if (link.includes('](http') && !link.includes('https://')) {
          score -= 1;
          issues.push(`${filename}: HTTP 링크 발견 (HTTPS 권장)`);
        }
      });
    }

    return Math.max(0, score);
  }

  /**
   * 가독성 체크
   */
  checkReadability(docs) {
    let score = 100;

    for (const [filename, content] of Object.entries(docs)) {
      const lines = content.split('\n');

      // 너무 긴 줄 체크 (120자 이상)
      const longLines = lines.filter(line => line.length > 120);
      if (longLines.length > 5) {
        score -= longLines.length * 0.5;
      }

      // 헤딩 계층 구조 체크
      const headings = content.match(/^#{1,6} .+$/gm) || [];
      let prevLevel = 0;
      headings.forEach(heading => {
        const level = heading.match(/^#+/)[0].length;
        if (level - prevLevel > 1) {
          score -= 3; // 계층 건너뛰기 (예: # → ###)
        }
        prevLevel = level;
      });

      // 코드 예시와 설명 비율
      const codeBlockCount = (content.match(/```/g) || []).length / 2;
      const textLength = content.replace(/```[\s\S]*?```/g, '').length;
      const codeRatio = (content.length - textLength) / content.length;

      if (codeRatio > 0.7) {
        score -= 10; // 코드가 너무 많고 설명이 부족
      }

      // 빈 섹션 체크
      if (content.includes('##') && content.match(/##\s*\w+\s*\n\s*##/)) {
        score -= 5;
      }
    }

    return Math.max(0, score);
  }

  /**
   * 시각화 체크
   */
  checkVisualization(docs) {
    let score = 100;
    let diagramCount = 0;

    for (const [filename, content] of Object.entries(docs)) {
      // Mermaid 다이어그램
      const mermaidDiagrams = content.match(/```mermaid[\s\S]*?```/g) || [];
      diagramCount += mermaidDiagrams.length;

      // 이미지
      const images = content.match(/!\[.*?\]\(.*?\)/g) || [];
      diagramCount += images.length;

      // ARCHITECTURE.md는 반드시 다이어그램 필요
      if (filename === 'ARCHITECTURE.md' && mermaidDiagrams.length === 0) {
        score -= 30;
      }

      // DATABASE.md에 ERD 필요
      if (filename === 'DATABASE.md' && !content.includes('```mermaid')) {
        score -= 20;
      }
    }

    // 전체 문서에 다이어그램이 너무 적으면
    if (diagramCount < 3) {
      score -= (3 - diagramCount) * 15;
    }

    return Math.max(0, score);
  }

  /**
   * 일관성 체크
   */
  checkConsistency(docs) {
    let score = 100;

    // 용어 사용 일관성
    const terms = {};
    for (const content of Object.values(docs)) {
      const words = content.toLowerCase().match(/\b\w{4,}\b/g) || [];
      words.forEach(word => {
        terms[word] = (terms[word] || 0) + 1;
      });
    }

    // 스타일 일관성 (헤딩 형식)
    const headingStyles = new Set();
    for (const content of Object.values(docs)) {
      const headings = content.match(/^#{1,6} .+$/gm) || [];
      headings.forEach(h => {
        // 이모지 사용 여부
        if (/[\u{1F000}-\u{1F9FF}]/u.test(h)) {
          headingStyles.add('emoji');
        } else {
          headingStyles.add('plain');
        }
      });
    }

    if (headingStyles.size > 1) {
      score -= 10; // 헤딩 스타일이 일관되지 않음
    }

    // Frontmatter 일관성
    const hasFrontmatter = Object.values(docs).map(content =>
      content.startsWith('---')
    );

    const allHave = hasFrontmatter.every(v => v);
    const noneHave = hasFrontmatter.every(v => !v);

    if (!allHave && !noneHave) {
      score -= 15; // 일부만 frontmatter 있음
    }

    return Math.max(0, score);
  }

  /**
   * 이슈 찾기
   */
  async findIssues(docs) {
    const issues = [];

    for (const [filename, content] of Object.entries(docs)) {
      // 필수 섹션 누락
      if (filename === 'README.md') {
        if (!content.includes('설치') && !content.includes('Install')) {
          issues.push({
            file: filename,
            severity: 'high',
            message: '설치 방법 섹션 누락',
            suggestion: '"설치" 또는 "Installation" 섹션 추가 필요'
          });
        }
        if (!content.includes('사용') && !content.includes('Usage')) {
          issues.push({
            file: filename,
            severity: 'high',
            message: '사용 방법 섹션 누락',
            suggestion: '"사용법" 또는 "Usage" 섹션 추가 필요'
          });
        }
      }

      // API 문서 이슈
      if (filename === 'API.md') {
        if (!content.includes('```json') && !content.includes('```')) {
          issues.push({
            file: filename,
            severity: 'medium',
            message: 'API 예시 코드 없음',
            suggestion: 'Request/Response 예시 추가 권장'
          });
        }
        if (!content.includes('인증') && !content.includes('auth')) {
          issues.push({
            file: filename,
            severity: 'medium',
            message: '인증 방법 설명 누락',
            suggestion: 'API 인증 방법 문서화 필요'
          });
        }
      }

      // 코드 블록 문법 오류
      const codeBlockStarts = (content.match(/```/g) || []).length;
      if (codeBlockStarts % 2 !== 0) {
        issues.push({
          file: filename,
          severity: 'high',
          message: '코드 블록 닫기 누락',
          suggestion: '모든 ``` 코드 블록이 제대로 닫혔는지 확인'
        });
      }

      // 상대 링크 체크
      const brokenLinks = content.match(/\]\(\.\/.+?\)/g) || [];
      if (brokenLinks.length > 0) {
        issues.push({
          file: filename,
          severity: 'low',
          message: '상대 경로 링크 발견',
          suggestion: '링크가 실제 파일을 가리키는지 확인 필요'
        });
      }
    }

    return issues;
  }

  /**
   * 개선 제안
   */
  async suggestImprovements(docs) {
    const improvements = [];

    // ARCHITECTURE.md 개선
    const archContent = docs['ARCHITECTURE.md'] || '';
    if (!archContent.includes('배포')) {
      improvements.push('ARCHITECTURE.md에 배포 아키텍처 다이어그램 추가 권장');
    }
    if (!archContent.includes('보안')) {
      improvements.push('ARCHITECTURE.md에 보안 고려사항 섹션 추가 권장');
    }

    // API.md 개선
    const apiContent = docs['API.md'] || '';
    if (!apiContent.includes('rate limit')) {
      improvements.push('API.md에 Rate Limiting 정책 추가 권장');
    }
    if (!apiContent.includes('pagination')) {
      improvements.push('API.md에 페이지네이션 방법 설명 추가 권장');
    }

    // SETUP.md 개선
    const setupContent = docs['SETUP.md'] || '';
    if (!setupContent.includes('Docker')) {
      improvements.push('SETUP.md에 Docker를 이용한 설치 방법 추가 권장');
    }
    if (!setupContent.includes('트러블슈팅')) {
      improvements.push('SETUP.md에 자주 발생하는 문제 해결 방법 추가 권장');
    }

    // 전반적 개선
    const totalDiagrams = Object.values(docs).join('').match(/```mermaid/g)?.length || 0;
    if (totalDiagrams < 3) {
      improvements.push('전체적으로 다이어그램을 더 추가하여 시각적 이해도 향상 권장');
    }

    // 예시 코드
    const totalCodeBlocks = Object.values(docs).join('').match(/```\w/g)?.length || 0;
    if (totalCodeBlocks < 5) {
      improvements.push('더 많은 코드 예시를 추가하여 실용성 향상 권장');
    }

    return improvements;
  }

  /**
   * 누락된 다이어그램 찾기
   */
  async findMissingDiagrams(docs) {
    const missing = [];

    const archContent = docs['ARCHITECTURE.md'] || '';

    if (!archContent.includes('시퀀스') && !archContent.includes('sequence')) {
      missing.push({
        type: 'sequence',
        title: 'API 요청 흐름 시퀀스 다이어그램',
        priority: 'high',
        location: 'ARCHITECTURE.md'
      });
    }

    if (!archContent.includes('class') && !archContent.includes('클래스')) {
      missing.push({
        type: 'class',
        title: '주요 클래스 다이어그램',
        priority: 'medium',
        location: 'ARCHITECTURE.md'
      });
    }

    const dbContent = docs['DATABASE.md'] || '';
    if (!dbContent.includes('erDiagram') && !dbContent.includes('ERD')) {
      missing.push({
        type: 'erd',
        title: '데이터베이스 ERD',
        priority: 'high',
        location: 'DATABASE.md'
      });
    }

    const setupContent = docs['SETUP.md'] || '';
    if (!setupContent.includes('flowchart') && !setupContent.includes('graph')) {
      missing.push({
        type: 'flowchart',
        title: '설치 과정 플로우차트',
        priority: 'low',
        location: 'SETUP.md'
      });
    }

    return missing;
  }

  /**
   * 강점 식별
   */
  async identifyStrengths(docs) {
    const strengths = [];

    // Frontmatter 사용
    const hasFrontmatter = Object.values(docs).every(content =>
      content.startsWith('---')
    );
    if (hasFrontmatter) {
      strengths.push('모든 문서에 일관된 frontmatter 메타데이터 사용');
    }

    // 다이어그램 사용
    const diagramCount = Object.values(docs).join('').match(/```mermaid/g)?.length || 0;
    if (diagramCount >= 5) {
      strengths.push(`풍부한 시각 자료 (${diagramCount}개 다이어그램)`);
    }

    // 코드 예시
    const codeBlockCount = Object.values(docs).join('').match(/```\w/g)?.length || 0;
    if (codeBlockCount >= 10) {
      strengths.push(`충분한 코드 예시 (${codeBlockCount}개)`);
    }

    // 구조화된 문서
    const headingCount = Object.values(docs).join('').match(/^#{1,6} /gm)?.length || 0;
    if (headingCount >= 20) {
      strengths.push('체계적인 문서 구조');
    }

    // 상호 참조
    const crossRefs = Object.values(docs).join('').match(/\]\(\.\//g)?.length || 0;
    if (crossRefs >= 3) {
      strengths.push('문서 간 효과적인 상호 참조');
    }

    return strengths;
  }

  /**
   * 리포트 생성
   */
  generateReport(results) {
    let report = `
# 📊 문서 품질 검토 리포트

## 종합 점수: ${Math.round(results.overall_score)}/100

### 카테고리별 점수
${Object.entries(results.category_scores).map(([category, data]) =>
  `- ${data.name}: ${Math.round(data.score)}/100 (가중치 ${data.weight * 100}%)`
).join('\n')}

`;

    // 치명적 이슈들을 먼저 표시
    if (results.forbidden_sections && results.forbidden_sections.length > 0) {
      report += `## 🚫 금지된 섹션 발견 (${results.forbidden_sections.length}개) - 즉시 수정 필요\n\n`;
      results.forbidden_sections.forEach(issue => {
        report += `### ${issue.file}\n`;
        report += `- **섹션**: ${issue.section}\n`;
        report += `- **발견된 내용**: \`${issue.example}\`\n`;
        report += `- **조치**: ${issue.suggestion}\n\n`;
      });
    }

    if (results.language_issues && results.language_issues.length > 0) {
      report += `## 🌐 한글/영어 혼용 이슈 (${results.language_issues.length}개)\n\n`;
      results.language_issues.forEach(issue => {
        report += `### ${issue.file}\n`;
        report += `- **심각도**: ${issue.severity}\n`;
        report += `- **문제**: ${issue.message}\n`;
        report += `- **예시**: \`${issue.example}\`\n`;
        report += `- **제안**: ${issue.suggestion}\n\n`;
      });
    }

    if (results.markdown_issues && results.markdown_issues.length > 0) {
      report += `## 📝 마크다운 형식 이슈 (${results.markdown_issues.length}개)\n\n`;
      results.markdown_issues.forEach(issue => {
        report += `### ${issue.file}\n`;
        report += `- **심각도**: ${issue.severity}\n`;
        report += `- **문제**: ${issue.message}\n`;
        if (issue.examples) {
          report += `- **예시**: ${issue.examples.slice(0, 2).map(ex => `\`${ex}\``).join(', ')}\n`;
        }
        report += `- **제안**: ${issue.suggestion}\n\n`;
      });
    }

    report += `## ✅ 강점
${results.strengths && results.strengths.length > 0 ? results.strengths.map(s => `- ${s}`).join('\n') : '- (강점 분석 중)'}

## ⚠️ 일반 이슈 (${results.issues.length}개)

${results.issues.map(issue => `
### ${issue.file}
- **심각도**: ${issue.severity}
- **문제**: ${issue.message}
- **제안**: ${issue.suggestion}
`).join('\n')}

## 💡 개선 제안
${results.improvements && results.improvements.length > 0 ? results.improvements.map(i => `- ${i}`).join('\n') : '- (개선사항 없음)'}

## 📈 누락된 다이어그램
${results.missing_diagrams && results.missing_diagrams.length > 0 ?
  results.missing_diagrams.map(d => `- [${d.priority.toUpperCase()}] ${d.title} (${d.location})`).join('\n')
  : '- (누락된 다이어그램 없음)'}

---
*검토 완료 시간: ${new Date().toISOString()}*
`;

    return report;
  }

  /**
   * 사용자 피드백 저장
   */
  async storeFeedback(feedback) {
    console.log('[Review Agent] 피드백 저장:', feedback);

    if (!this.stateManager) {
      console.warn('[Review Agent] StateManager 없음 - 피드백 저장 불가');
      return { success: false, error: 'StateManager not configured' };
    }

    const feedbackEntry = {
      timestamp: new Date().toISOString(),
      feedback: feedback.message || feedback,
      category: this.categorizeFeedback(feedback),
      severity: this.assessFeedbackSeverity(feedback)
    };

    // StateManager에 피드백 저장
    await this.stateManager.addFeedback(feedbackEntry);

    return {
      success: true,
      feedbackEntry: feedbackEntry,
      message: '피드백이 저장되었습니다.'
    };
  }

  /**
   * 피드백 카테고리화
   */
  categorizeFeedback(feedback) {
    const text = (feedback.message || feedback).toLowerCase();

    if (text.includes('api') || text.includes('엔드포인트')) return 'api_documentation';
    if (text.includes('예시') || text.includes('example')) return 'code_examples';
    if (text.includes('다이어그램') || text.includes('diagram')) return 'visualization';
    if (text.includes('설명') || text.includes('description')) return 'explanation';
    if (text.includes('구조') || text.includes('architecture')) return 'architecture';
    if (text.includes('설치') || text.includes('setup')) return 'setup_guide';
    if (text.includes('보안') || text.includes('security')) return 'security';

    return 'general';
  }

  /**
   * 피드백 심각도 평가
   */
  assessFeedbackSeverity(feedback) {
    const text = (feedback.message || feedback).toLowerCase();

    if (text.includes('항상') || text.includes('매번') || text.includes('never')) return 'high';
    if (text.includes('자주') || text.includes('often')) return 'medium';
    if (text.includes('가끔') || text.includes('sometimes')) return 'low';

    return 'medium'; // 기본값
  }

  /**
   * 피드백 패턴 분석
   */
  async analyzeFeedbackPatterns() {
    console.log('[Review Agent] 피드백 패턴 분석 시작');

    if (!this.stateManager) {
      return { success: false, error: 'StateManager not configured' };
    }

    const feedbackHistory = await this.stateManager.getFeedbackHistory();

    if (!feedbackHistory || feedbackHistory.length === 0) {
      return {
        success: true,
        patterns: [],
        message: '저장된 피드백이 없습니다.'
      };
    }

    // 카테고리별 빈도 분석
    const categoryCount = {};
    const severityCount = { high: 0, medium: 0, low: 0 };

    feedbackHistory.forEach(entry => {
      // 카테고리 카운트
      const category = entry.category || 'general';
      categoryCount[category] = (categoryCount[category] || 0) + 1;

      // 심각도 카운트
      const severity = entry.severity || 'medium';
      severityCount[severity] = (severityCount[severity] || 0) + 1;
    });

    // 가장 빈번한 문제 식별
    const sortedCategories = Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const patterns = sortedCategories.map(([category, count]) => ({
      category,
      count,
      percentage: Math.round((count / feedbackHistory.length) * 100),
      examples: feedbackHistory
        .filter(f => f.category === category)
        .slice(0, 2)
        .map(f => f.feedback)
    }));

    return {
      success: true,
      totalFeedback: feedbackHistory.length,
      patterns: patterns,
      severityDistribution: severityCount
    };
  }

  /**
   * 프롬프트 개선 제안
   */
  async suggestPromptImprovements() {
    console.log('[Review Agent] 프롬프트 개선 제안 생성');

    const analysis = await this.analyzeFeedbackPatterns();

    if (!analysis.success || analysis.patterns.length === 0) {
      return {
        success: false,
        message: '프롬프트 개선 제안을 생성할 충분한 피드백이 없습니다.'
      };
    }

    const suggestions = [];

    // 패턴 기반 개선 제안
    for (const pattern of analysis.patterns) {
      const suggestion = this.createImprovementSuggestion(pattern);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    // 심각도 높은 피드백 우선 처리
    if (analysis.severityDistribution.high > 0) {
      suggestions.unshift({
        priority: 'critical',
        message: `${analysis.severityDistribution.high}개의 높은 심각도 피드백이 있습니다. 즉시 대응이 필요합니다.`
      });
    }

    return {
      success: true,
      suggestions: suggestions,
      analysisDetails: analysis
    };
  }

  /**
   * 개선 제안 생성
   */
  createImprovementSuggestion(pattern) {
    const { category, count, percentage, examples } = pattern;

    const suggestionMap = {
      'api_documentation': {
        agent: 'CODE_AGENT',
        issue: `API 문서가 ${count}회 피드백됨 (${percentage}%)`,
        suggestion: '다음 지시사항을 CODE_AGENT 프롬프트에 추가:\n- 각 API 엔드포인트마다 curl 예시 필수 포함\n- Request/Response 예시를 JSON 형식으로 제공\n- 에러 코드 및 처리 방법 명시',
        promptAddition: `
## API Documentation Requirements (MANDATORY)
- Include curl examples for every endpoint
- Provide JSON request/response examples
- Document error codes and handling
- Include authentication details`
      },
      'code_examples': {
        agent: 'CODE_AGENT',
        issue: `코드 예시 부족 피드백 ${count}회 (${percentage}%)`,
        suggestion: '다음 지시사항을 CODE_AGENT 프롬프트에 추가:\n- 모든 주요 기능에 코드 예시 필수\n- 실제 동작하는 완전한 예시 제공\n- 주석으로 각 단계 설명',
        promptAddition: `
## Code Examples Requirements (MANDATORY)
- Include working code examples for all major features
- Add comments explaining each step
- Provide both basic and advanced usage examples`
      },
      'visualization': {
        agent: 'CODE_AGENT',
        issue: `다이어그램 관련 피드백 ${count}회 (${percentage}%)`,
        suggestion: '다음 지시사항을 CODE_AGENT 프롬프트에 추가:\n- 최소 3개 이상의 Mermaid 다이어그램 필수\n- 아키텍처 문서에 시퀀스 다이어그램 포함\n- 데이터베이스 문서에 ERD 포함',
        promptAddition: `
## Diagram Requirements (MANDATORY)
- Minimum 3 Mermaid diagrams required
- Architecture: Include sequence diagrams
- Database: Include ERD
- Use consistent diagram styling`
      },
      'explanation': {
        agent: 'CODE_AGENT',
        issue: `설명 부족 피드백 ${count}회 (${percentage}%)`,
        suggestion: '다음 지시사항을 CODE_AGENT 프롬프트에 추가:\n- 각 섹션마다 상세한 설명 제공\n- "왜" 그렇게 설계되었는지 설명\n- 대안 접근법 및 트레이드오프 설명',
        promptAddition: `
## Explanation Requirements (MANDATORY)
- Provide detailed explanations for each section
- Explain "why" design decisions were made
- Document trade-offs and alternatives`
      }
    };

    const template = suggestionMap[category];

    if (!template) {
      return {
        agent: 'CODE_AGENT',
        category: category,
        issue: `${category} 관련 피드백 ${count}회`,
        suggestion: '해당 카테고리에 대한 문서 품질 개선 필요',
        promptAddition: null
      };
    }

    return {
      ...template,
      category: category,
      frequency: count,
      examples: examples
    };
  }

  /**
   * 프롬프트 수정 확인 요청
   */
  async askForPromptModification() {
    console.log('[Review Agent] 프롬프트 수정 확인 요청');

    const improvements = await this.suggestPromptImprovements();

    if (!improvements.success) {
      return improvements;
    }

    // 사용자에게 보여줄 메시지 생성
    const message = this.formatModificationRequest(improvements.suggestions);

    return {
      success: true,
      requiresUserConfirmation: true,
      message: message,
      suggestions: improvements.suggestions
    };
  }

  /**
   * 수정 요청 메시지 포맷팅
   */
  formatModificationRequest(suggestions) {
    let message = `## 프롬프트 개선 제안\n\n`;
    message += `피드백 분석 결과, 다음과 같은 프롬프트 수정을 제안합니다:\n\n`;

    suggestions.forEach((suggestion, index) => {
      message += `### ${index + 1}. ${suggestion.agent}\n\n`;
      message += `**문제:** ${suggestion.issue}\n\n`;
      message += `**제안사항:**\n${suggestion.suggestion}\n\n`;

      if (suggestion.promptAddition) {
        message += `**추가할 프롬프트:**\n\`\`\`\n${suggestion.promptAddition}\n\`\`\`\n\n`;
      }

      if (suggestion.examples && suggestion.examples.length > 0) {
        message += `**관련 피드백 예시:**\n`;
        suggestion.examples.forEach(ex => {
          message += `- "${ex}"\n`;
        });
        message += `\n`;
      }

      message += `---\n\n`;
    });

    message += `\n**이 수정사항을 적용하시겠습니까?**\n`;
    message += `- "예" 또는 "수정 적용": 모든 제안사항 적용\n`;
    message += `- 번호 지정 (예: "1, 3"): 특정 제안만 적용\n`;
    message += `- "아니오": 적용 안 함\n`;

    return message;
  }
}
