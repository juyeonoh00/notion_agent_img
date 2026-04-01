/**
 * Notion Agent: Markdown → Notion 페이지 자동 생성
 */

import { Client } from '@notionhq/client';
import { readFile, access } from 'fs/promises';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

export class NotionAgent {
  constructor(apiKey, options = {}) {
    this.notion = apiKey ? new Client({ auth: apiKey }) : null;
    this.githubUsername = options.githubUsername || process.env.GITHUB_USERNAME;
    this.githubRepoName = options.githubRepoName || process.env.GITHUB_REPO_NAME;
    this.githubBranch = options.githubBranch || process.env.GITHUB_BRANCH || 'master';
    this.iconMap = {
      // 영어 파일명
      'README.md': '📄',
      'ARCHITECTURE.md': '🏗️',
      'API.md': '🔌',
      'DATABASE.md': '💾',
      'SETUP.md': '⚙️',
      'TESTING.md': '🧪',
      'DEPLOYMENT.md': '🚀',
      'CONTRIBUTING.md': '🤝',
      // 한글 파일명 (키워드 매칭)
      'default': '📝'
    };
  }

  /**
   * 파일명에서 적절한 아이콘 찾기
   */
  getIconForFile(filename) {
    // 정확한 매칭
    if (this.iconMap[filename]) {
      return this.iconMap[filename];
    }

    // 키워드 매칭 (한글/영어)
    const lowerName = filename.toLowerCase();
    if (lowerName.includes('개요') || lowerName.includes('readme')) return '📄';
    if (lowerName.includes('아키텍처') || lowerName.includes('architecture')) return '🏗️';
    if (lowerName.includes('api')) return '🔌';
    if (lowerName.includes('데이터베이스') || lowerName.includes('database')) return '💾';
    if (lowerName.includes('설정') || lowerName.includes('setup')) return '⚙️';
    if (lowerName.includes('테스트') || lowerName.includes('test')) return '🧪';
    if (lowerName.includes('배포') || lowerName.includes('deploy')) return '🚀';
    if (lowerName.includes('기여') || lowerName.includes('contribut')) return '🤝';

    return this.iconMap.default;
  }

  /**
   * Markdown 문서들을 Notion 페이지로 생성
   */
  async createNotionPages(docs, options = {}) {
    if (!this.notion) {
      return {
        success: false,
        error: 'Notion API 키가 설정되지 않았습니다.',
        simulation: this.simulateCreation(docs, options)
      };
    }

    console.log('[Notion Agent] Notion 페이지 생성 시작...');

    const { parentPageId, databaseId } = options;
    const results = {
      pages: [],
      database: null,
      errors: []
    };

    try {
      // 옵션 1: 상위 페이지 하위에 생성
      if (parentPageId) {
        for (const [filename, content] of Object.entries(docs)) {
          try {
            const page = await this.createPage(parentPageId, filename, content);
            results.pages.push(page);
          } catch (error) {
            results.errors.push({ file: filename, error: error.message });
          }
        }
      }
      // 옵션 2: 데이터베이스에 생성
      else if (databaseId) {
        for (const [filename, content] of Object.entries(docs)) {
          try {
            const page = await this.createDatabasePage(databaseId, filename, content);
            results.pages.push(page);
          } catch (error) {
            results.errors.push({ file: filename, error: error.message });
          }
        }
      }
      // 옵션 3: 새 상위 페이지 + 하위 페이지들 생성
      else {
        // 먼저 프로젝트 루트 페이지 생성
        const rootPage = await this.createRootPage(docs);
        results.pages.push(rootPage);

        // 각 문서를 하위 페이지로 생성
        for (const [filename, content] of Object.entries(docs)) {
          if (filename !== 'README.md') { // README는 루트에 포함
            try {
              const page = await this.createPage(rootPage.id, filename, content);
              results.pages.push(page);
            } catch (error) {
              results.errors.push({ file: filename, error: error.message });
            }
          }
        }
      }

      return {
        success: true,
        pages: results.pages,
        errors: results.errors
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        partial_results: results
      };
    }
  }

  /**
   * 프로젝트 루트 페이지 생성
   */
  async createRootPage(docs) {
    const readmeContent = docs['README.md'] || '';
    const projectName = this.extractProjectName(readmeContent);

    const blocks = await this.convertMarkdownToBlocks(readmeContent);

    const page = await this.notion.pages.create({
      parent: { type: 'page_id', page_id: process.env.NOTION_PARENT_PAGE_ID },
      icon: { type: 'emoji', emoji: '📁' },
      properties: {
        title: {
          title: [{ text: { content: projectName } }]
        }
      },
      children: blocks
    });

    return {
      id: page.id,
      title: projectName,
      url: page.url,
      icon: '📁'
    };
  }

  /**
   * 개별 페이지 생성
   */
  async createPage(parentId, filename, content) {
    const title = this.extractTitle(filename, content);
    const icon = this.getIconForFile(filename);
    const blocks = await this.convertMarkdownToBlocks(content);

    // Notion API는 한 번에 100개 블록까지만 허용
    const chunkedBlocks = this.chunkBlocks(blocks, 100);

    const page = await this.notion.pages.create({
      parent: { type: 'page_id', page_id: parentId },
      icon: { type: 'emoji', emoji: icon },
      properties: {
        title: {
          title: [{ text: { content: title } }]
        }
      },
      children: chunkedBlocks[0] || []
    });

    // 나머지 블록 추가
    for (let i = 1; i < chunkedBlocks.length; i++) {
      await this.notion.blocks.children.append({
        block_id: page.id,
        children: chunkedBlocks[i]
      });
    }

    return {
      id: page.id,
      title,
      url: page.url,
      icon,
      blocks_count: blocks.length
    };
  }

  /**
   * 데이터베이스 페이지 생성
   */
  async createDatabasePage(databaseId, filename, content) {
    const title = this.extractTitle(filename, content);
    const blocks = await this.convertMarkdownToBlocks(content);

    const page = await this.notion.pages.create({
      parent: { type: 'database_id', database_id: databaseId },
      icon: { type: 'emoji', emoji: this.getIconForFile(filename) },
      properties: {
        Name: {
          title: [{ text: { content: title } }]
        },
        Type: {
          select: { name: this.getDocType(filename) }
        },
        Status: {
          select: { name: 'Published' }
        }
      },
      children: this.chunkBlocks(blocks, 100)[0] || []
    });

    return {
      id: page.id,
      title,
      url: page.url
    };
  }

  /**
   * Markdown → Notion Blocks 변환 (헤딩을 실제 헤딩으로, HTML 제거)
   */
  async convertMarkdownToBlocks(markdown) {
    const allBlocks = [];

    // HTML 태그 제거 (Notion에서 지원 안 함)
    markdown = this.removeHtmlTags(markdown);

    const lines = markdown.split('\n');
    let i = 0;

    // Frontmatter 제거
    if (lines[0] === '---') {
      i = lines.findIndex((line, idx) => idx > 0 && line === '---') + 1;
    }

    // 첫 번째 # 헤딩 건너뛰기 (페이지 제목과 중복)
    while (i < lines.length) {
      const line = lines[i].trim();
      if (line.match(/^#\s+/)) {
        i++;
        while (i < lines.length && lines[i].trim() === '') {
          i++;
        }
        break;
      } else if (line !== '') {
        break;
      }
      i++;
    }

    // 섹션별로 파싱 (헤딩을 실제 헤딩 블록으로 변환)
    while (i < lines.length) {
      const line = lines[i];

      // 헤딩을 실제 heading 블록으로 변환 (토글 아님)
      if (line.match(/^#{2,6}\s+/)) {
        const block = this.createHeadingBlock(line);
        allBlocks.push(block);
        i++;
      } else {
        // 일반 블록 처리
        const { block, nextIndex } = this.parseSingleBlock(lines, i);
        if (block) allBlocks.push(block);
        i = nextIndex;
      }
    }

    // 로컬 이미지 자동 업로드 처리
    await this.processLocalImages(allBlocks);

    return allBlocks;
  }

  /**
   * HTML 태그 제거 (Notion에서 지원 안 함)
   */
  removeHtmlTags(markdown) {
    // <div>, <span>, <center> 등 블록 레벨 태그 제거
    markdown = markdown.replace(/<div[^>]*>/gi, '');
    markdown = markdown.replace(/<\/div>/gi, '');
    markdown = markdown.replace(/<center[^>]*>/gi, '');
    markdown = markdown.replace(/<\/center>/gi, '');
    markdown = markdown.replace(/<span[^>]*>/gi, '');
    markdown = markdown.replace(/<\/span>/gi, '');

    // align 속성 제거
    markdown = markdown.replace(/align="[^"]*"/gi, '');

    // 빈 줄 정리
    markdown = markdown.replace(/\n\n\n+/g, '\n\n');

    return markdown;
  }

  /**
   * 블록 배열에서 로컬 이미지를 찾아 자동으로 Imgur에 업로드
   */
  async processLocalImages(blocks) {
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      // 토글 블록의 children도 재귀 처리
      if (block.type === 'toggle' && block.toggle.children) {
        await this.processLocalImages(block.toggle.children);
      }

      // 로컬 이미지 경로가 있는 callout 블록 찾기
      if (block.type === 'callout' && block.__localImagePath) {
        const imagePath = block.__localImagePath;

        try {
          console.log(`  📤 로컬 이미지 발견: ${imagePath}`);
          console.log(`  ⏳ Imgur 업로드 중...`);

          // 절대 경로로 변환
          const absolutePath = resolve(imagePath);

          // 파일 존재 확인
          try {
            await access(absolutePath);
          } catch {
            console.log(`  ⚠️  파일을 찾을 수 없음, 건너뜀`);
            continue;
          }

          // GitHub에 이미지 업로드
          const imageUrl = await this.uploadImageToGitHub(absolutePath);

          // callout을 image 블록으로 교체
          blocks[i] = {
            type: 'image',
            image: {
              type: 'external',
              external: { url: imageUrl }
            }
          };

        } catch (error) {
          console.log(`  ❌ 업로드 실패: ${error.message}`);
          // 실패 시 callout으로 유지 (오류 메시지 표시)
          block.callout.rich_text[0].text.content += ` (업로드 실패)`;
          block.callout.color = 'red_background';
          delete block.__localImagePath; // 중요: Notion API가 거부하는 속성 제거
        }
      }
    }
  }

  /**
   * 이미지를 GitHub에 업로드하고 raw URL 반환
   */
  async uploadImageToGitHub(imagePath) {
    if (!this.githubUsername || !this.githubRepoName) {
      throw new Error('GitHub 설정이 없습니다. GITHUB_USERNAME과 GITHUB_REPO_NAME을 .env에 설정하세요.');
    }

    try {
      // 절대 경로를 프로젝트 상대 경로로 변환
      const absolutePath = resolve(imagePath);
      const cwd = process.cwd();
      const relativePath = absolutePath.replace(cwd + '\\', '').replace(cwd + '/', '').replace(/\\/g, '/');

      console.log(`  🔄 GitHub 업로드 시도: ${relativePath}`);

      // Git에 파일 추가
      execSync(`git add "${absolutePath}"`, { cwd, stdio: 'pipe' });

      // 변경사항이 있는지 확인
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' });

      if (status.trim()) {
        // Commit
        const commitMessage = `Add image: ${relativePath.split('/').pop()}`;
        try {
          execSync(`git commit -m "${commitMessage}"`, { cwd, stdio: 'pipe' });

          // Push
          console.log(`  ⏳ GitHub push 중...`);
          execSync(`git push origin ${this.githubBranch}`, { cwd, stdio: 'pipe' });
          console.log(`  ✅ GitHub push 완료`);
        } catch (commitError) {
          // Commit 실패는 무시 (이미 커밋되어 있을 수 있음)
          console.log(`  ℹ️  이미 커밋됨`);
        }
      } else {
        console.log(`  ℹ️  변경사항 없음 (이미 업로드됨)`);
      }

      // GitHub raw URL 생성
      const rawUrl = `https://raw.githubusercontent.com/${this.githubUsername}/${this.githubRepoName}/${this.githubBranch}/${relativePath}`;

      return rawUrl;

    } catch (error) {
      throw new Error(`GitHub 업로드 실패: ${error.message}`);
    }
  }

  /**
   * 토글 섹션 생성 (헤딩 + 그 아래 내용)
   */
  createToggleSection(lines, startIndex) {
    const headingLine = lines[startIndex];
    const match = headingLine.match(/^(#{2,6})\s+(.+)$/);
    const headingText = match ? match[2] : headingLine;

    // 다음 헤딩까지의 내용을 children으로 수집
    let i = startIndex + 1;
    const childrenBlocks = [];

    while (i < lines.length) {
      const line = lines[i];

      // 같은 레벨 또는 상위 레벨 헤딩을 만나면 중단
      if (line.match(/^#{1,6}\s+/)) {
        const currentLevel = line.match(/^(#{1,6})/)[1].length;
        const headingLevel = match[1].length;
        if (currentLevel <= headingLevel) {
          break;
        }
      }

      // 블록 파싱
      const { block, nextIndex } = this.parseSingleBlock(lines, i);
      if (block) childrenBlocks.push(block);
      i = nextIndex;
    }

    return {
      toggle: {
        type: 'toggle',
        toggle: {
          rich_text: this.parseRichText(headingText),
          children: childrenBlocks.slice(0, 100) // Notion 제한
        }
      },
      nextIndex: i
    };
  }

  /**
   * 단일 블록 파싱 (토글 제외)
   */
  parseSingleBlock(lines, i) {
    const line = lines[i];

    // 빈 줄
    if (line.trim() === '') {
      return { block: null, nextIndex: i + 1 };
    }

    // 코드 블록
    if (line.startsWith('```')) {
      const { block, nextIndex } = this.createCodeBlock(lines, i);
      return { block, nextIndex };
    }
    // 테이블
    else if (line.match(/^\|(.+)\|$/)) {
      const { blockList, nextIndex } = this.createTableBlock(lines, i);
      // 테이블은 여러 블록이므로 첫 번째만 반환 (실제로는 전체 테이블이 callout으로 래핑됨)
      return { block: blockList[0], nextIndex };
    }
    // 리스트
    else if (line.match(/^[-*] /) || line.match(/^\d+\. /)) {
      const { blockList, nextIndex } = this.createListBlocks(lines, i);
      return { block: blockList[0], nextIndex };
    }
    // 이미지 (로컬 경로는 자동 업로드 필요, 나중에 처리)
    else if (line.match(/!\[([^\]]*)\]\(([^)]+)\)/)) {
      const match = line.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      const alt = match[1];
      const urlOrPath = match[2];

      // 이미 HTTP URL이면 바로 사용
      if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
        return {
          block: {
            type: 'image',
            image: {
              type: 'external',
              external: { url: urlOrPath }
            }
          },
          nextIndex: i + 1
        };
      }

      // 로컬 경로는 표시만 (나중에 업로드)
      return {
        block: {
          type: 'callout',
          callout: {
            rich_text: [{ text: { content: `🖼️ 이미지: ${alt} (${urlOrPath})` } }],
            icon: { emoji: '📷' },
            color: 'gray_background'
          },
          __localImagePath: urlOrPath  // 나중에 처리할 경로 저장
        },
        nextIndex: i + 1
      };
    }
    // 인용
    else if (line.startsWith('> ')) {
      return { block: this.createQuoteBlock(line), nextIndex: i + 1 };
    }
    // 구분선
    else if (line.match(/^---+$/)) {
      return { block: { type: 'divider', divider: {} }, nextIndex: i + 1 };
    }
    // 일반 텍스트
    else if (line.trim()) {
      return { block: this.createParagraphBlock(line), nextIndex: i + 1 };
    }

    return { block: null, nextIndex: i + 1 };
  }

  /**
   * 헤딩 블록 생성
   * # → heading_1, ## → heading_2, ### → heading_3, #### → heading_4
   * ##### 이상은 heading_4로 매핑
   */
  createHeadingBlock(line) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) {
      // 매칭 실패 시 paragraph로 처리
      return this.createParagraphBlock(line);
    }

    const level = match[1].length;
    const text = match[2];

    // Notion heading_4까지 지원
    const type = level === 1 ? 'heading_1' :
                 level === 2 ? 'heading_2' :
                 level === 3 ? 'heading_3' :
                 'heading_4';  // 4 이상은 모두 heading_4

    return {
      type,
      [type]: {
        rich_text: this.parseRichText(text)
      }
    };
  }

  /**
   * 코드 블록 생성
   */
  createCodeBlock(lines, startIndex) {
    const firstLine = lines[startIndex];
    const language = firstLine.replace('```', '').trim() || 'plain text';

    let endIndex = startIndex + 1;
    while (endIndex < lines.length && !lines[endIndex].startsWith('```')) {
      endIndex++;
    }

    const code = lines.slice(startIndex + 1, endIndex).join('\n');

    return {
      block: {
        type: 'code',
        code: {
          rich_text: [{ text: { content: code.slice(0, 2000) } }], // Notion 제한
          language: this.mapLanguage(language)
        }
      },
      nextIndex: endIndex + 1
    };
  }

  /**
   * 리스트 블록 생성
   */
  createListBlocks(lines, startIndex) {
    const blockList = [];
    let i = startIndex;

    while (i < lines.length && (lines[i].match(/^[-*] /) || lines[i].match(/^\d+\. /))) {
      const line = lines[i];
      const isNumbered = line.match(/^\d+\. /);
      const text = line.replace(/^[-*] /, '').replace(/^\d+\. /, '');

      const type = isNumbered ? 'numbered_list_item' : 'bulleted_list_item';

      blockList.push({
        type,
        [type]: {
          rich_text: this.parseRichText(text)
        }
      });

      i++;
    }

    return { blockList, nextIndex: i };
  }

  /**
   * 인용 블록 생성
   */
  createQuoteBlock(line) {
    const text = line.replace(/^> /, '');
    return {
      type: 'quote',
      quote: {
        rich_text: this.parseRichText(text)
      }
    };
  }

  /**
   * 단락 블록 생성
   */
  createParagraphBlock(line) {
    return {
      type: 'paragraph',
      paragraph: {
        rich_text: this.parseRichText(line)
      }
    };
  }

  /**
   * 테이블 블록 생성
   * Notion API 제약으로 테이블을 간단한 리스트로 변환
   */
  createTableBlock(lines, startIndex) {
    const tableLines = [];
    let i = startIndex;

    // 테이블 라인 수집
    while (i < lines.length && lines[i].match(/^\|(.+)\|$/)) {
      tableLines.push(lines[i]);
      i++;
    }

    if (tableLines.length < 2) {
      // 테이블이 너무 짧음
      return { blockList: [], nextIndex: i };
    }

    // 헤더 파싱
    const headerCells = this.parseTableRow(tableLines[0]);

    // 구분선 스킵 (|------|------|)
    let dataStartIndex = 1;
    if (tableLines[1].match(/^\|[\s:-]+\|$/)) {
      dataStartIndex = 2;
    }

    // 데이터 행 파싱
    const dataRows = [];
    for (let j = dataStartIndex; j < tableLines.length; j++) {
      const cells = this.parseTableRow(tableLines[j]);
      if (cells.length > 0) {
        dataRows.push(cells);
      }
    }

    const tableBlocks = [];

    // 헤더를 heading_3으로
    const headerText = headerCells.join(' | ');
    tableBlocks.push({
      type: 'heading_3',
      heading_3: {
        rich_text: this.parseRichText(headerText)
      }
    });

    // 각 행을 bulleted_list로 (더 읽기 쉽게)
    dataRows.forEach(row => {
      const rowItems = [];
      row.forEach((cell, idx) => {
        if (idx < headerCells.length) {
          rowItems.push(`${headerCells[idx]}: ${cell}`);
        } else {
          rowItems.push(cell);
        }
      });

      tableBlocks.push({
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: this.parseRichText(rowItems.join(' • '))
        }
      });
    });

    return {
      blockList: tableBlocks,
      nextIndex: i
    };
  }

  /**
   * 테이블 행 파싱
   */
  parseTableRow(line) {
    // | cell1 | cell2 | cell3 | 형식
    const cells = line
      .split('|')
      .slice(1, -1) // 양 끝 빈 문자열 제거
      .map(cell => cell.trim())
      .filter(cell => cell && !cell.match(/^[-:]+$/)); // 구분선 제외

    return cells;
  }

  /**
   * Rich Text 파싱 (볼드, 이탤릭, 코드 등)
   */
  parseRichText(text) {
    const richText = [];
    // ** 볼드를 먼저 매칭하도록 순서 조정 (더 긴 패턴을 먼저)
    const segments = text.split(/(\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`|\[.+?\]\(.+?\))/);

    segments.forEach(segment => {
      if (!segment) return;

      // 볼드 (** 먼저 체크)
      if (segment.startsWith('**') && segment.endsWith('**') && segment.length > 4) {
        richText.push({
          text: { content: segment.slice(2, -2) },
          annotations: { bold: true }
        });
      }
      // 이탤릭 (* 체크, 하지만 **가 아닌지 확인)
      else if (segment.startsWith('*') && segment.endsWith('*') && !segment.startsWith('**') && segment.length > 2) {
        richText.push({
          text: { content: segment.slice(1, -1) },
          annotations: { italic: true }
        });
      }
      // 인라인 코드
      else if (segment.startsWith('`') && segment.endsWith('`') && segment.length > 2) {
        richText.push({
          text: { content: segment.slice(1, -1) },
          annotations: { code: true }
        });
      }
      // 링크
      else if (segment.match(/\[.+?\]\(.+?\)/)) {
        const match = segment.match(/\[(.+?)\]\((.+?)\)/);
        if (match) {
          const linkText = match[1];
          const linkUrl = match[2];

          // 내부 앵커 링크(#으로 시작)는 일반 텍스트로 처리
          if (linkUrl.startsWith('#')) {
            richText.push({
              text: { content: linkText },
              annotations: { bold: true }  // 강조 표시
            });
          }
          // 유효한 URL만 링크로 처리
          else if (linkUrl.match(/^https?:\/\//) || linkUrl.match(/^mailto:/)) {
            richText.push({
              text: { content: linkText, link: { url: linkUrl } }
            });
          }
          // 상대 경로나 기타 링크는 일반 텍스트로
          else {
            richText.push({
              text: { content: `${linkText} (${linkUrl})` }
            });
          }
        } else {
          richText.push({ text: { content: segment } });
        }
      }
      // 일반 텍스트
      else {
        richText.push({ text: { content: segment } });
      }
    });

    return richText.length > 0 ? richText : [{ text: { content: text } }];
  }

  /**
   * 언어 매핑 (Notion 지원 언어로)
   */
  mapLanguage(lang) {
    const map = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'rb': 'ruby',
      'sh': 'shell',
      'bash': 'shell',
      'yml': 'yaml',
      'yaml': 'yaml',
      '.env': 'shell',
      'env': 'shell',
      'dotenv': 'shell',
      'config': 'plain text',
      'txt': 'plain text',
      'log': 'plain text'
    };

    const normalized = lang.toLowerCase().trim();

    // Notion 지원 언어 목록
    const notionLanguages = [
      'abap', 'abc', 'agda', 'arduino', 'ascii art', 'assembly', 'bash', 'basic', 'bnf',
      'c', 'c#', 'c++', 'clojure', 'coffeescript', 'coq', 'css', 'dart', 'dhall', 'diff',
      'docker', 'ebnf', 'elixir', 'elm', 'erlang', 'f#', 'flow', 'fortran', 'gherkin',
      'glsl', 'go', 'graphql', 'groovy', 'haskell', 'hcl', 'html', 'idris', 'java',
      'javascript', 'json', 'julia', 'kotlin', 'latex', 'less', 'lisp', 'livescript',
      'llvm ir', 'lua', 'makefile', 'markdown', 'markup', 'matlab', 'mathematica',
      'mermaid', 'nix', 'notion formula', 'objective-c', 'ocaml', 'pascal', 'perl',
      'php', 'plain text', 'powershell', 'prolog', 'protobuf', 'purescript', 'python',
      'r', 'racket', 'reason', 'ruby', 'rust', 'sass', 'scala', 'scheme', 'scss',
      'shell', 'smalltalk', 'solidity', 'sql', 'swift', 'toml', 'typescript', 'vb.net',
      'verilog', 'vhdl', 'visual basic', 'webassembly', 'xml', 'yaml'
    ];

    const mapped = map[normalized] || normalized;

    // Notion이 지원하는 언어인지 확인
    if (notionLanguages.includes(mapped)) {
      return mapped;
    }

    // 지원하지 않으면 plain text로
    return 'plain text';
  }

  /**
   * 블록 청킹 (Notion API 제한)
   */
  chunkBlocks(blocks, size) {
    const chunks = [];
    for (let i = 0; i < blocks.length; i += size) {
      chunks.push(blocks.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * 유틸리티: 프로젝트 이름 추출
   */
  extractProjectName(readme) {
    const match = readme.match(/^#\s+(.+)$/m);
    return match ? match[1] : '프로젝트 문서';
  }

  /**
   * 유틸리티: 문서 제목 추출
   */
  extractTitle(filename, content) {
    // Frontmatter에서 title 추출 시도
    const frontmatterMatch = content.match(/^---\n[\s\S]*?title:\s*(.+?)\n[\s\S]*?---/);
    if (frontmatterMatch) {
      return this.removeEmojis(frontmatterMatch[1]);
    }

    // 첫 번째 # 헤딩 추출
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return this.removeEmojis(headingMatch[1]);
    }

    // 파일명에서 추출
    return filename.replace('.md', '').replace(/_/g, ' ');
  }

  /**
   * 문자열에서 이모지 제거
   */
  removeEmojis(text) {
    // 이모지 유니코드 범위 제거
    return text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();
  }

  /**
   * 문서 타입 결정
   */
  getDocType(filename) {
    const lowerName = filename.toLowerCase();

    if (lowerName.includes('readme') || lowerName.includes('개요')) return 'Overview';
    if (lowerName.includes('architecture') || lowerName.includes('아키텍처')) return 'Architecture';
    if (lowerName.includes('api')) return 'API Reference';
    if (lowerName.includes('database') || lowerName.includes('데이터베이스')) return 'Database';
    if (lowerName.includes('setup') || lowerName.includes('설정')) return 'Setup Guide';
    if (lowerName.includes('test') || lowerName.includes('테스트')) return 'Testing';
    if (lowerName.includes('deploy') || lowerName.includes('배포')) return 'Deployment';

    return 'Documentation';
  }

  /**
   * 시뮬레이션 (API 키 없을 때)
   */
  simulateCreation(docs, options) {
    return {
      message: 'Notion API 키가 없어 시뮬레이션 모드로 실행됨',
      would_create: Object.keys(docs).map(filename => ({
        title: this.extractTitle(filename, docs[filename]),
        icon: this.getIconForFile(filename),
        type: this.getDocType(filename),
        blocks_count: docs[filename].split('\n').length
      })),
      next_steps: [
        '1. Notion Integration 생성 (https://www.notion.so/my-integrations)',
        '2. Internal Integration Token 발급',
        '3. 환경 변수 NOTION_API_KEY 설정',
        '4. 상위 페이지에 Integration 권한 부여'
      ]
    };
  }

  /**
   * 기존 Notion 페이지 업데이트 (증분 업데이트)
   */
  async updateNotionPage(pageId, filename, newContent) {
    if (!this.notion) {
      return {
        success: false,
        error: 'Notion API 키가 설정되지 않았습니다.'
      };
    }

    try {
      console.log(`[Notion Agent] 페이지 증분 업데이트 중: ${filename}`);

      // 1. 기존 Notion 블록 가져오기
      const notionBlocks = await this.getPageBlocks(pageId);

      // 2. 새 MD를 블록으로 변환
      const mdBlocks = await this.convertMarkdownToBlocks(newContent);

      console.log(`  기존 블록: ${notionBlocks.length}개, 새 블록: ${mdBlocks.length}개`);

      // 3. 블록별 비교 및 업데이트
      let updatedCount = 0;
      let addedCount = 0;
      let replacedCount = 0;

      const maxLen = Math.max(notionBlocks.length, mdBlocks.length);

      for (let i = 0; i < maxLen; i++) {
        const notionBlock = notionBlocks[i];
        const mdBlock = mdBlocks[i];

        if (notionBlock && mdBlock) {
          // 둘 다 있음
          if (notionBlock.type !== mdBlock.type) {
            // 타입이 다르면 삭제 후 재생성 (Notion 제약)
            await this.replaceBlock(notionBlock.id, mdBlock, pageId);
            replacedCount++;
          }
          else if (await this.shouldUpdateBlock(notionBlock, mdBlock)) {
            // 타입이 같고 스타일이 다르면 업데이트
            await this.updateBlock(notionBlock.id, mdBlock);
            updatedCount++;
          }
        }
        else if (!notionBlock && mdBlock) {
          // MD에만 있음 - 추가
          await this.appendBlockAtPosition(pageId, mdBlock, i);
          addedCount++;
        }
        // Notion에만 있음 - 유지 (사용자가 추가한 내용)
      }

      console.log(`  ✅ ${updatedCount}개 업데이트, ${replacedCount}개 교체, ${addedCount}개 추가`);

      // 페이지 정보 가져오기
      const page = await this.notion.pages.retrieve({ page_id: pageId });

      return {
        success: true,
        pageId,
        url: page.url,
        filename,
        updated: updatedCount,
        replaced: replacedCount,
        added: addedCount,
        preserved: notionBlocks.length - updatedCount - replacedCount
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        pageId
      };
    }
  }

  /**
   * 페이지의 모든 블록 가져오기
   */
  async getPageBlocks(pageId) {
    const blocks = [];
    let cursor = undefined;

    while (true) {
      const response = await this.notion.blocks.children.list({
        block_id: pageId,
        start_cursor: cursor,
        page_size: 100
      });

      blocks.push(...response.results);

      if (!response.has_more) break;
      cursor = response.next_cursor;
    }

    return blocks;
  }

  /**
   * 블록 업데이트 필요 여부 판단
   */
  async shouldUpdateBlock(notionBlock, mdBlock) {
    // 1. 타입이 다르면 업데이트 필요
    if (notionBlock.type !== mdBlock.type) {
      return true;
    }

    // 2. 타입이 같으면 스타일(annotations) 비교
    const notionRichText = notionBlock[notionBlock.type]?.rich_text || [];
    const mdRichText = mdBlock[mdBlock.type]?.rich_text || [];

    // rich_text가 없으면 업데이트 불필요
    if (notionRichText.length === 0 && mdRichText.length === 0) {
      return false;
    }

    // 스타일이 다르면 업데이트 필요
    return this.hasStyleDifference(notionRichText, mdRichText);
  }

  /**
   * 스타일 차이 확인
   */
  hasStyleDifference(notionRichText, mdRichText) {
    // MD의 annotations (bold, italic, code 등) 추출
    const mdHasBold = mdRichText.some(rt => rt.annotations?.bold);
    const mdHasItalic = mdRichText.some(rt => rt.annotations?.italic);
    const mdHasCode = mdRichText.some(rt => rt.annotations?.code);

    // Notion의 annotations 추출
    const notionHasBold = notionRichText.some(rt => rt.annotations?.bold);
    const notionHasItalic = notionRichText.some(rt => rt.annotations?.italic);
    const notionHasCode = notionRichText.some(rt => rt.annotations?.code);

    // 스타일이 다르면 true
    return mdHasBold !== notionHasBold ||
           mdHasItalic !== notionHasItalic ||
           mdHasCode !== notionHasCode;
  }

  /**
   * 블록 업데이트
   */
  async updateBlock(blockId, mdBlock) {
    const blockType = mdBlock.type;

    // 타입별 업데이트 가능 여부
    const updatableTypes = [
      'paragraph', 'heading_1', 'heading_2', 'heading_3',
      'bulleted_list_item', 'numbered_list_item', 'quote', 'callout'
    ];

    if (!updatableTypes.includes(blockType)) {
      // 업데이트 불가능한 타입 (code, divider 등)은 스킵
      return;
    }

    try {
      // 기존 블록 정보 가져오기
      const existingBlock = await this.notion.blocks.retrieve({ block_id: blockId });
      const existingRichText = existingBlock[blockType]?.rich_text || [];

      // Notion 내용 + MD 스타일 적용
      const updatedRichText = this.applyStyleToRichText(existingRichText, mdBlock[blockType].rich_text);

      // 블록 업데이트
      await this.notion.blocks.update({
        block_id: blockId,
        [blockType]: {
          rich_text: updatedRichText
        }
      });
    } catch (error) {
      console.error(`블록 업데이트 실패 (${blockId}):`, error.message);
    }
  }

  /**
   * Notion 내용에 MD 스타일 적용
   */
  applyStyleToRichText(notionRichText, mdRichText) {
    if (notionRichText.length === 0) {
      return mdRichText; // Notion이 비어있으면 MD 사용
    }

    // MD의 스타일 추출
    const mdHasBold = mdRichText.some(rt => rt.annotations?.bold);
    const mdHasItalic = mdRichText.some(rt => rt.annotations?.italic);
    const mdHasCode = mdRichText.some(rt => rt.annotations?.code);

    // Notion 내용에 MD 스타일 적용
    return notionRichText.map(rt => ({
      ...rt,
      annotations: {
        ...rt.annotations,
        bold: mdHasBold || rt.annotations?.bold || false,
        italic: mdHasItalic || rt.annotations?.italic || false,
        code: mdHasCode || rt.annotations?.code || false
      }
    }));
  }

  /**
   * 블록 타입 변경 (간단한 방식: 삭제 후 끝에 추가)
   * Notion API는 블록 타입을 직접 변경할 수 없고, 특정 위치에 삽입하는 기능도 없음
   *
   * 이 방법은 순서가 약간 틀어질 수 있지만, 블록 재구성으로 인한 오류를 방지함
   */
  async replaceBlock(blockId, newBlock, pageId) {
    try {
      // 1. 기존 블록 삭제
      await this.notion.blocks.delete({
        block_id: blockId
      });

      // 2. 새 블록을 페이지 끝에 추가
      // (순서는 틀어지지만, 안전하게 추가됨)
      await this.notion.blocks.children.append({
        block_id: pageId,
        children: [newBlock]
      });

      console.log(`  ℹ️  블록 타입 변경: 페이지 끝으로 이동됨`);
    } catch (error) {
      console.error(`블록 교체 실패 (${blockId}):`, error.message);
    }
  }

  /**
   * 기존 Notion 블록을 새 블록 데이터로 변환
   */
  convertExistingBlockToNew(block) {
    const type = block.type;

    // 지원하지 않는 타입은 스킵
    if (!block[type]) return null;

    const newBlock = {
      type: type,
      [type]: {}
    };

    // rich_text가 있는 경우
    if (block[type].rich_text) {
      newBlock[type].rich_text = block[type].rich_text;
    }

    // code 블록의 경우 language 속성 필수
    if (type === 'code') {
      newBlock[type].language = block[type].language || 'plain text';
      if (block[type].caption) {
        newBlock[type].caption = block[type].caption;
      }
    }

    // callout 블록의 경우 icon, color 속성 복사
    if (type === 'callout') {
      if (block[type].icon) newBlock[type].icon = block[type].icon;
      if (block[type].color) newBlock[type].color = block[type].color;
    }

    // numbered_list_item 등은 추가 속성 없음

    return newBlock;
  }

  /**
   * 특정 위치에 블록 추가
   */
  async appendBlockAtPosition(pageId, block, position) {
    try {
      await this.notion.blocks.children.append({
        block_id: pageId,
        children: [block]
      });
    } catch (error) {
      console.error(`블록 추가 실패 (위치 ${position}):`, error.message);
    }
  }

  /**
   * 페이지의 모든 블록 삭제
   */
  async deletePageBlocks(pageId) {
    try {
      // 페이지의 모든 블록 가져오기
      const response = await this.notion.blocks.children.list({
        block_id: pageId
      });

      // 모든 블록을 병렬로 삭제 (훨씬 빠름!)
      await Promise.all(
        response.results.map(block =>
          this.notion.blocks.delete({ block_id: block.id }).catch(err => {
            // 이미 삭제되었거나 아카이브된 블록은 무시
            if (!err.message.includes('archived')) {
              console.error(`블록 ${block.id} 삭제 실패:`, err.message);
            }
          })
        )
      );
    } catch (error) {
      console.error('블록 삭제 오류:', error.message);
    }
  }

  /**
   * 전체 교체 업데이트
   * 기존 블록 전부 삭제 후 Markdown 내용으로 재생성
   */
  async updatePageEfficiently(pageId, filename, newContent, oldContent = null) {
    console.log(`[Notion Agent] 전체 교체 업데이트 중: ${filename}`);

    // 1. 기존 블록 모두 삭제
    console.log(`  🗑️  기존 블록 삭제 중...`);
    await this.deletePageBlocks(pageId);

    // 2. 새 Markdown을 블록으로 변환
    const newBlocks = await this.convertMarkdownToBlocks(newContent);
    console.log(`  📝 새 블록: ${newBlocks.length}개`);

    // 3. 새 블록 배치로 추가 (Notion API는 한 번에 최대 100개)
    console.log(`  ➕ 새 블록 추가 중...`);
    const BATCH_SIZE = 100;
    for (let i = 0; i < newBlocks.length; i += BATCH_SIZE) {
      const batch = newBlocks.slice(i, i + BATCH_SIZE);
      console.log(`    📦 배치 ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length}개 블록 추가 중...`);
      await this.notion.blocks.children.append({
        block_id: pageId,
        children: batch
      });
    }

    console.log(`  ✅ 완료!`);

    return {
      success: true,
      total: newBlocks.length,
      url: `https://www.notion.so/${pageId.replace(/-/g, '')}`
    };
  }

  /**
   * 블록에서 텍스트 추출 (비교용)
   */
  extractBlockText(block) {
    const blockType = block.type;
    const blockData = block[blockType];

    if (!blockData || !blockData.rich_text) {
      return '';
    }

    return blockData.rich_text
      .map(rt => rt.text?.content || rt.plain_text || '')
      .join('');
  }

  /**
   * Notion 블록들을 Markdown으로 변환
   */
  convertNotionBlocksToMarkdown(blocks) {
    const lines = [];

    for (const block of blocks) {
      const type = block.type;
      const blockData = block[type];

      if (!blockData) continue;

      switch (type) {
        case 'heading_1':
          lines.push(`# ${this.extractBlockText(block)}`);
          lines.push('');
          break;

        case 'heading_2':
          lines.push(`## ${this.extractBlockText(block)}`);
          lines.push('');
          break;

        case 'heading_3':
          lines.push(`### ${this.extractBlockText(block)}`);
          lines.push('');
          break;

        case 'paragraph':
          const text = this.extractBlockText(block);
          if (text) {
            lines.push(text);
            lines.push('');
          }
          break;

        case 'bulleted_list_item':
          lines.push(`- ${this.extractBlockText(block)}`);
          break;

        case 'numbered_list_item':
          lines.push(`1. ${this.extractBlockText(block)}`);
          break;

        case 'quote':
          lines.push(`> ${this.extractBlockText(block)}`);
          lines.push('');
          break;

        case 'code':
          const language = blockData.language || '';
          lines.push('```' + language);
          lines.push(this.extractBlockText(block));
          lines.push('```');
          lines.push('');
          break;

        case 'divider':
          lines.push('---');
          lines.push('');
          break;

        case 'callout':
          // Callout은 인용문으로 변환
          lines.push(`> ${this.extractBlockText(block)}`);
          lines.push('');
          break;

        // 다른 타입은 일단 스킵
        default:
          break;
      }
    }

    return lines.join('\n');
  }

  /**
   * Notion 페이지를 Markdown으로 다운로드
   */
  async downloadNotionPage(pageId, filename) {
    if (!this.notion) {
      return {
        success: false,
        error: 'Notion API 키가 설정되지 않았습니다.'
      };
    }

    try {
      console.log(`[Notion Agent] 페이지 다운로드 중: ${filename}`);

      // 1. Notion 블록 가져오기
      const blocks = await this.getPageBlocks(pageId);
      console.log(`  📥 ${blocks.length}개 블록 다운로드`);

      // 2. Markdown으로 변환
      const markdown = this.convertNotionBlocksToMarkdown(blocks);
      console.log(`  ✅ Markdown 변환 완료`);

      return {
        success: true,
        content: markdown,
        blocksCount: blocks.length
      };
    } catch (error) {
      console.error(`페이지 다운로드 실패: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 여러 페이지 일괄 업데이트
   */
  async updateMultiplePages(updates) {
    const results = [];

    for (const update of updates) {
      const result = await this.updatePageEfficiently(
        update.pageId,
        update.filename,
        update.content,
        update.oldContent
      );
      results.push(result);
    }

    return {
      success: results.every(r => r.success),
      results,
      successCount: results.filter(r => r.success).length,
      failCount: results.filter(r => !r.success).length
    };
  }

  /**
   * 페이지 제목 업데이트
   */
  async updatePageTitle(pageId, newTitle) {
    if (!this.notion) {
      return { success: false, error: 'Notion API 키가 설정되지 않았습니다.' };
    }

    try {
      await this.notion.pages.update({
        page_id: pageId,
        properties: {
          title: {
            title: [{ text: { content: newTitle } }]
          }
        }
      });

      return { success: true, pageId, newTitle };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 페이지 삭제 후 재생성 (완전 교체)
   * - 기존 페이지를 아카이브(삭제)
   * - 같은 위치에 새 페이지 생성
   */
  async deleteAndRecreatePage(pageId, filename, content) {
    if (!this.notion) {
      return {
        success: false,
        error: 'Notion API 키가 설정되지 않았습니다.'
      };
    }

    try {
      console.log(`[Notion Agent] 페이지 삭제 후 재생성: ${filename}`);

      // 1. 기존 페이지 정보 가져오기
      console.log(`  📥 기존 페이지 정보 가져오는 중...`);
      const oldPage = await this.notion.pages.retrieve({ page_id: pageId });

      const parentId = oldPage.parent?.page_id || process.env.NOTION_PARENT_PAGE_ID;
      const oldTitle = oldPage.properties?.title?.title?.[0]?.plain_text ||
                       oldPage.properties?.Name?.title?.[0]?.plain_text ||
                       this.extractTitle(filename, content);
      const oldIcon = oldPage.icon?.emoji || this.getIconForFile(filename);

      console.log(`  📄 제목: ${oldTitle}`);
      console.log(`  📁 부모 ID: ${parentId}`);

      // 2. 기존 페이지 아카이브(삭제)
      console.log(`  🗑️  기존 페이지 아카이브 중...`);
      await this.notion.pages.update({
        page_id: pageId,
        archived: true
      });

      // 3. 새 페이지 생성
      console.log(`  ✨ 새 페이지 생성 중...`);
      const newPage = await this.createPage(parentId, filename, content);

      console.log(`  ✅ 완료!`);

      return {
        success: true,
        oldPageId: pageId,
        newPageId: newPage.id,
        title: newPage.title,
        url: newPage.url,
        icon: newPage.icon,
        blocksCount: newPage.blocks_count
      };
    } catch (error) {
      console.error(`페이지 재생성 실패: ${error.message}`);
      return {
        success: false,
        error: error.message,
        pageId
      };
    }
  }

  /**
   * 여러 Notion 페이지를 Markdown으로 일괄 다운로드
   */
  async downloadNotionPages(pageInfoList) {
    if (!this.notion) {
      return {
        success: false,
        error: 'Notion API 키가 설정되지 않았습니다.'
      };
    }

    console.log(`[Notion Agent] ${pageInfoList.length}개 페이지 다운로드 시작`);

    const results = [];
    for (const pageInfo of pageInfoList) {
      const result = await this.downloadNotionPage(pageInfo.pageId, pageInfo.filename);
      results.push({
        filename: pageInfo.filename,
        ...result
      });
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`✅ ${successCount}/${pageInfoList.length}개 페이지 다운로드 완료`);

    return {
      success: results.every(r => r.success),
      results,
      successCount,
      failCount: results.length - successCount
    };
  }

  /**
   * 파일명으로 Notion 페이지 검색 (StateManager 사용)
   */
  async findPageByFilename(filename, stateManager = null) {
    // 1. StateManager에서 먼저 찾기
    if (stateManager) {
      const pageInfo = stateManager.getNotionPage(filename);
      if (pageInfo) {
        console.log(`[Notion Agent] StateManager에서 페이지 발견: ${filename}`);
        return {
          success: true,
          pageId: pageInfo.id,
          url: pageInfo.url,
          source: 'stateManager'
        };
      }
    }

    // 2. Notion에서 검색
    if (!this.notion) {
      return {
        success: false,
        error: 'Notion API 키가 설정되지 않았고 StateManager에도 정보가 없습니다.'
      };
    }

    try {
      console.log(`[Notion Agent] Notion에서 페이지 검색 중: ${filename}`);

      const title = this.extractTitle(filename, '');
      const searchResults = await this.notion.search({
        query: title,
        filter: {
          property: 'object',
          value: 'page'
        }
      });

      if (searchResults.results.length === 0) {
        return {
          success: false,
          error: `페이지를 찾을 수 없습니다: ${filename}`
        };
      }

      // 첫 번째 결과 반환
      const page = searchResults.results[0];
      return {
        success: true,
        pageId: page.id,
        url: page.url,
        source: 'notionSearch',
        matchCount: searchResults.results.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 로컬 문서를 Notion에 동기화 (생성 또는 업데이트)
   */
  async syncToNotion(docs, stateManager = null, options = {}) {
    console.log('[Notion Agent] Notion 동기화 시작');

    const results = [];

    for (const [filename, content] of Object.entries(docs)) {
      try {
        // StateManager에서 기존 페이지 확인
        const pageInfo = stateManager?.getNotionPage(filename);

        if (pageInfo) {
          // 기존 페이지 업데이트
          console.log(`  🔄 업데이트: ${filename}`);
          const updateMode = options.updateMode || 'efficient'; // 'efficient', 'incremental', 'recreate'

          let result;
          if (updateMode === 'incremental') {
            result = await this.updateNotionPage(pageInfo.id, filename, content);
          } else if (updateMode === 'recreate') {
            result = await this.deleteAndRecreatePage(pageInfo.id, filename, content);
            // 새 페이지 ID로 StateManager 업데이트
            if (result.success && stateManager) {
              stateManager.setNotionPage(filename, result.newPageId, result.url);
            }
          } else {
            // 기본: efficient (전체 교체)
            result = await this.updatePageEfficiently(pageInfo.id, filename, content);
          }

          results.push({ filename, action: 'updated', ...result });
        } else {
          // 새 페이지 생성
          console.log(`  ✨ 생성: ${filename}`);
          const parentPageId = options.parentPageId || process.env.NOTION_PARENT_PAGE_ID;
          const page = await this.createPage(parentPageId, filename, content);

          // StateManager에 저장
          if (stateManager) {
            stateManager.setNotionPage(filename, page.id, page.url);
          }

          results.push({ filename, action: 'created', success: true, ...page });
        }
      } catch (error) {
        results.push({
          filename,
          action: 'failed',
          success: false,
          error: error.message
        });
      }
    }

    // StateManager 저장
    if (stateManager) {
      await stateManager.saveSession();
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`✅ ${successCount}/${results.length}개 파일 동기화 완료`);

    return {
      success: results.every(r => r.success),
      results,
      successCount,
      failCount: results.length - successCount
    };
  }

  /**
   * Notion에서 로컬로 동기화 (다운로드)
   */
  async syncFromNotion(filenames, stateManager = null) {
    console.log('[Notion Agent] Notion에서 다운로드 시작');

    if (!stateManager) {
      return {
        success: false,
        error: 'StateManager가 필요합니다.'
      };
    }

    const results = [];

    for (const filename of filenames) {
      try {
        // StateManager에서 페이지 정보 가져오기
        const pageInfo = stateManager.getNotionPage(filename);

        if (!pageInfo) {
          results.push({
            filename,
            success: false,
            error: 'StateManager에 페이지 정보가 없습니다.'
          });
          continue;
        }

        // 다운로드
        console.log(`  📥 다운로드: ${filename}`);
        const result = await this.downloadNotionPage(pageInfo.id, filename);

        if (result.success) {
          // StateManager에 최신 내용 저장
          stateManager.setDocument(filename, result.content);
        }

        results.push({ filename, ...result });
      } catch (error) {
        results.push({
          filename,
          success: false,
          error: error.message
        });
      }
    }

    // StateManager 저장
    await stateManager.saveSession();

    const successCount = results.filter(r => r.success).length;
    console.log(`✅ ${successCount}/${results.length}개 파일 다운로드 완료`);

    return {
      success: results.every(r => r.success),
      results,
      successCount,
      failCount: results.length - successCount,
      documents: results.reduce((acc, r) => {
        if (r.success) {
          acc[r.filename] = r.content;
        }
        return acc;
      }, {})
    };
  }

  /**
   * Notion 페이지 존재 여부 확인
   */
  async pageExists(pageId) {
    if (!this.notion) {
      return false;
    }

    try {
      await this.notion.pages.retrieve({ page_id: pageId });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * StateManager와 Notion 상태 검증
   */
  async validateSync(stateManager) {
    if (!this.notion || !stateManager) {
      return {
        valid: false,
        error: 'Notion API 키 또는 StateManager가 없습니다.'
      };
    }

    console.log('[Notion Agent] 동기화 상태 검증 중...');

    const notionPages = stateManager.getAllNotionPages();
    const validation = [];

    for (const [filename, pageInfo] of Object.entries(notionPages)) {
      const exists = await this.pageExists(pageInfo.id);
      validation.push({
        filename,
        pageId: pageInfo.id,
        exists,
        lastUpdated: pageInfo.lastUpdated
      });
    }

    const invalidCount = validation.filter(v => !v.exists).length;

    if (invalidCount > 0) {
      console.log(`⚠️  ${invalidCount}개 페이지가 Notion에 존재하지 않습니다.`);
    } else {
      console.log(`✅ 모든 페이지가 유효합니다.`);
    }

    return {
      valid: invalidCount === 0,
      validation,
      invalidCount,
      totalCount: validation.length
    };
  }
}
