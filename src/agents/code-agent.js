/**
 * Code Agent: 코드베이스 분석 → Markdown 문서 생성
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, extname, relative } from 'path';
import { glob } from 'glob';

export class CodeAgent {
  constructor() {
    this.supportedExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.rb', '.php', '.cs'];
    this.ignorePatterns = ['node_modules', 'dist', 'build', '.git', 'coverage', '__pycache__'];

    // 글자수 제한 설정 (사용자 요구사항: 페이지당 500자 기준)
    this.sectionLengthLimits = {
      target: 500,      // 목표 글자수
      min: 150,         // 최소 글자수 (너무 짧으면 경고)
      max: 1000,        // 최대 글자수 (초과 시 분할)
      comfortable: 800  // 편안한 최대 길이
    };
  }

  /**
   * 프로젝트 분석 → 문서 생성
   */
  async generateDocs(projectPath, options = {}) {
    console.log(`[Code Agent] 프로젝트 분석 시작: ${projectPath}`);

    const analysis = await this.analyzeProject(projectPath);
    const docs = await this.createDocuments(analysis, options);

    // 마크다운 형식 검증 및 수정
    const validatedDocs = {};
    for (const [filename, content] of Object.entries(docs)) {
      validatedDocs[filename] = this.validateAndFixMarkdown(content, filename);
    }

    return {
      success: true,
      files: validatedDocs,
      analysis: {
        totalFiles: analysis.files.length,
        languages: analysis.languages,
        structure: analysis.structure
      }
    };
  }

  /**
   * 마크다운 형식 검증 및 자동 수정
   */
  validateAndFixMarkdown(content, filename) {
    console.log(`[Code Agent] 마크다운 검증 중: ${filename}`);

    let fixed = content;
    const issues = [];

    // 1. 헤딩 형식 검증 (### 뒤에 공백 없음)
    const badHeadings = fixed.match(/^#{1,6}[^\s#]/gm);
    if (badHeadings) {
      issues.push(`헤딩 형식 오류 발견: ${badHeadings.length}개`);
      // 자동 수정: ### 뒤에 공백 추가
      fixed = fixed.replace(/^(#{1,6})([^\s#])/gm, '$1 $2');
    }

    // 2. 코드 블록 짝 맞추기 (``` 개수가 홀수)
    const codeBlockCount = (fixed.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      issues.push(`코드 블록 닫기 누락 (``` 개수: ${codeBlockCount})`);
      // 자동 수정: 마지막에 ``` 추가
      fixed += '\n```\n';
    }

    // 3. 빈 헤딩 제거 (## \n##)
    const emptyHeadings = fixed.match(/^#{1,6}\s*\n\s*#{1,6}/gm);
    if (emptyHeadings) {
      issues.push(`빈 헤딩 발견: ${emptyHeadings.length}개`);
      fixed = fixed.replace(/^(#{1,6}\s*)\n(\s*#{1,6})/gm, '$2');
    }

    // 4. 연속된 빈 줄 정리 (3개 이상 → 2개로)
    fixed = fixed.replace(/\n{4,}/g, '\n\n\n');

    // 5. 목록 형식 검증 (- 뒤에 공백)
    fixed = fixed.replace(/^-([^\s-])/gm, '- $1');
    fixed = fixed.replace(/^\*([^\s*])/gm, '* $1');

    // 6. 코드 블록에 언어 지정 확인 및 추가 (```\n → ```bash\n or ```javascript\n)
    fixed = fixed.replace(/```\n(npm |curl |git |cd |mkdir |ls |rm )/gm, '```bash\n$1');
    fixed = fixed.replace(/```\n(const |let |var |function |import |export |async |class )/gm, '```javascript\n$1');
    fixed = fixed.replace(/```\n(\{|\[|")/gm, '```json\n$1');

    if (issues.length > 0) {
      console.log(`[Code Agent] ${filename}: ${issues.length}개 마크다운 이슈 수정함`);
      issues.forEach(issue => console.log(`  - ${issue}`));
    }

    return fixed;
  }

  /**
   * 프로젝트 구조 분석
   */
  async analyzeProject(projectPath) {
    const files = await this.getAllFiles(projectPath);
    const structure = await this.buildStructure(projectPath, files);
    const languages = this.detectLanguages(files);
    const dependencies = await this.findDependencies(projectPath);
    const apiEndpoints = await this.extractAPIEndpoints(files);
    const database = await this.analyzeDatabaseSchema(files);

    return {
      path: projectPath,
      files,
      structure,
      languages,
      dependencies,
      apiEndpoints,
      database
    };
  }

  /**
   * 모든 코드 파일 찾기
   */
  async getAllFiles(projectPath) {
    const pattern = `**/*{${this.supportedExtensions.join(',')}}`;
    const files = await glob(pattern, {
      cwd: projectPath,
      ignore: this.ignorePatterns,
      absolute: false
    });

    return files;
  }

  /**
   * 프로젝트 구조 트리 생성
   */
  async buildStructure(projectPath, files) {
    const tree = {};

    for (const file of files) {
      const parts = file.split(/[/\\]/);
      let current = tree;

      parts.forEach((part, index) => {
        if (index === parts.length - 1) {
          // 파일
          if (!current.__files) current.__files = [];
          current.__files.push(part);
        } else {
          // 디렉토리
          if (!current[part]) current[part] = {};
          current = current[part];
        }
      });
    }

    return tree;
  }

  /**
   * 언어 감지
   */
  detectLanguages(files) {
    const langMap = {
      '.js': 'JavaScript',
      '.ts': 'TypeScript',
      '.jsx': 'React (JSX)',
      '.tsx': 'React (TSX)',
      '.py': 'Python',
      '.java': 'Java',
      '.go': 'Go',
      '.rs': 'Rust',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.cs': 'C#'
    };

    const counts = {};
    files.forEach(file => {
      const ext = extname(file);
      const lang = langMap[ext] || 'Unknown';
      counts[lang] = (counts[lang] || 0) + 1;
    });

    return counts;
  }

  /**
   * 의존성 찾기
   */
  async findDependencies(projectPath) {
    const deps = { runtime: [], dev: [] };

    try {
      // package.json
      const pkgPath = join(projectPath, 'package.json');
      const pkgContent = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent);

      if (pkg.dependencies) {
        deps.runtime = Object.keys(pkg.dependencies);
      }
      if (pkg.devDependencies) {
        deps.dev = Object.keys(pkg.devDependencies);
      }
    } catch (e) {
      // package.json 없음
    }

    try {
      // requirements.txt
      const reqPath = join(projectPath, 'requirements.txt');
      const reqContent = await readFile(reqPath, 'utf-8');
      deps.runtime = reqContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    } catch (e) {
      // requirements.txt 없음
    }

    return deps;
  }

  /**
   * API 엔드포인트 추출
   */
  async extractAPIEndpoints(files) {
    const endpoints = [];
    const patterns = [
      // Express.js
      /app\.(get|post|put|delete|patch)\(['"](.+?)['"]/g,
      /@(Get|Post|Put|Delete|Patch)Mapping\(['"](.+?)['"]/g,
      // Spring Boot
      /@RequestMapping\(.*path\s*=\s*['"](.+?)['"]/g,
      // FastAPI
      /@app\.(get|post|put|delete|patch)\(['"](.+?)['"]/g
    ];

    // 실제 구현에서는 파일을 읽어서 패턴 매칭
    // 여기서는 간략화

    return endpoints;
  }

  /**
   * 데이터베이스 스키마 분석
   */
  async analyzeDatabaseSchema(files) {
    const schema = {
      tables: [],
      relations: []
    };

    // ORM 파일, migration 파일 등에서 스키마 추출
    // 실제 구현에서는 Sequelize, TypeORM, Django models 등 파싱

    return schema;
  }

  /**
   * 문서 생성 - 1개 통합 문서로 생성
   */
  async createDocuments(analysis, options) {
    const docs = {};
    const requirements = options.requirements || null;

    const projectName = analysis.path.split(/[/\\]/).pop();

    // 1개 통합 문서 생성
    let document = this.generateUnifiedDocument(analysis, requirements);

    // 목차 자동 생성 및 삽입
    document = this.insertTableOfContents(document);

    docs[`${projectName}.md`] = document;

    return docs;
  }

  /**
   * 목차 자동 생성 및 삽입
   */
  insertTableOfContents(document) {
    // 문서에서 모든 헤딩 추출 (## 레벨만)
    const headings = [];
    const headingRegex = /^##\s+(.+)$/gm;
    let match;

    while ((match = headingRegex.exec(document)) !== null) {
      const title = match[1].trim();
      // 목차 자체는 제외
      if (title !== '목차') {
        headings.push({
          title: title,
          anchor: this.createAnchor(title)
        });
      }
    }

    // 목차 생성
    if (headings.length === 0) {
      return document; // 헤딩이 없으면 목차 생성 안 함
    }

    let toc = `## 목차\n\n`;
    headings.forEach((heading, index) => {
      toc += `${index + 1}. [${heading.title}](#${heading.anchor})\n`;
    });
    toc += `\n---\n\n`;

    // 첫 번째 ## 헤딩 바로 앞에 목차 삽입
    const firstHeadingMatch = document.match(/^##\s+/m);
    if (firstHeadingMatch) {
      const insertPosition = firstHeadingMatch.index;
      document = document.slice(0, insertPosition) + toc + document.slice(insertPosition);
    }

    return document;
  }

  /**
   * 앵커 링크 생성 (GitHub/Notion 호환)
   */
  createAnchor(title) {
    // 한글, 영어, 숫자만 남기고 나머지 제거
    return title
      .toLowerCase()
      .replace(/\s+/g, '-')           // 공백을 하이픈으로
      .replace(/[^\w가-힣-]/g, '')    // 특수문자 제거
      .replace(/-+/g, '-')            // 연속 하이픈 정리
      .replace(/^-|-$/g, '');         // 앞뒤 하이픈 제거
  }

  /**
   * 섹션 길이 제어 - 너무 길면 요약, 너무 짧으면 확장
   */
  controlSectionLength(sectionContent, sectionName) {
    const length = sectionContent.length;
    const { target, min, max, comfortable } = this.sectionLengthLimits;

    // 적절한 길이면 그대로 반환
    if (length >= min && length <= comfortable) {
      return sectionContent;
    }

    // 너무 짧은 경우 (200자 미만) - 경고만 (억지로 늘리지 않음)
    if (length < min) {
      console.warn(`[Code Agent] 섹션 "${sectionName}" 이(가) 너무 짧습니다: ${length}자`);
      return sectionContent;
    }

    // 너무 긴 경우 (1500자 초과) - 요약 또는 분할 필요
    if (length > max) {
      console.warn(`[Code Agent] 섹션 "${sectionName}" 이(가) 너무 깁니다: ${length}자 -> 요약 권장`);
      // 실제 요약은 AI가 해야 하므로, 여기서는 경고만 출력
      // 필요 시 truncateLongSection() 호출
    }

    return sectionContent;
  }

  /**
   * 긴 섹션을 적절히 자르기 (임시 방안)
   */
  truncateLongSection(content, maxLength) {
    if (content.length <= maxLength) return content;

    // 문장 단위로 자르기 (마침표, 개행 등)
    const sentences = content.split(/([.!?]\s+|\n\n)/);
    let truncated = '';

    for (const sentence of sentences) {
      if ((truncated + sentence).length > maxLength) break;
      truncated += sentence;
    }

    return truncated + '\n\n(... 내용 생략 ...)';
  }

  /**
   * 통합 문서 생성
   */
  generateUnifiedDocument(analysis, requirements = null) {
    const projectName = analysis.path.split(/[/\\]/).pop();
    const primaryLang = Object.entries(analysis.languages)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

    let content = `# ${projectName}\n\n`;

    // 요구사항이 있으면 포함
    if (requirements) {
      content += `> **문서 작성 요구사항**: ${requirements}\n\n`;
    }

    content += `${primaryLang} 기반 프로젝트\n\n`;

    // 1. 프로젝트 개요
    content += this.generateOverviewSection(analysis);

    // 2. 아키텍처 (파일이 10개 이상)
    if (analysis.files.length >= 10) {
      content += this.generateArchitectureSection(analysis);
    }

    // 3. API 문서
    if (this.hasAPIFiles(analysis.files)) {
      content += this.generateAPISection(analysis);
    }

    // 4. 데이터베이스
    if (this.hasDatabaseFiles(analysis.files)) {
      content += this.generateDatabaseSection(analysis);
    }

    // 5. 설치 및 설정
    content += this.generateSetupSection(analysis);

    // 6. 테스트
    if (this.hasTestFiles(analysis.files)) {
      content += this.generateTestSection(analysis);
    }

    return content;
  }

  /**
   * 개요 섹션 생성 (간결화, 500자 기준)
   */
  generateOverviewSection(analysis) {
    const primaryLang = Object.entries(analysis.languages)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

    // 의존성 목록 길이 조절
    const maxDeps = 5; // 의존성 최대 표시 개수 줄임
    const structureTree = this.renderStructureTree(analysis.structure);
    const maxTreeLines = 10; // 구조 트리 최대 라인 수 줄임

    // 구조 트리가 너무 길면 잘라내기
    const treeLines = structureTree.split('\n');
    const truncatedTree = treeLines.length > maxTreeLines
      ? treeLines.slice(0, maxTreeLines).join('\n') + '\n  ... (생략)'
      : structureTree;

    const sectionContent = `## 프로젝트 개요

**주요 기술:** ${Object.entries(analysis.languages)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 3)
  .map(([lang]) => lang)
  .join(', ')}

주요 의존성:
${analysis.dependencies.runtime.length > 0 ?
  '> ' + analysis.dependencies.runtime.slice(0, maxDeps).join(', ') +
  (analysis.dependencies.runtime.length > maxDeps ? ` 외 ${analysis.dependencies.runtime.length - maxDeps}개` : '') :
  '> 의존성 정보 없음'}

상세 구조:
> \`\`\`
> ${truncatedTree}
> \`\`\`

---

`;

    return this.controlSectionLength(sectionContent, '프로젝트 개요');
  }

  /**
   * 아키텍처 섹션 생성 (글자수 제어 적용, Mermaid 제거)
   */
  generateArchitectureSection(analysis) {
    const structureExplanation = this.explainStructure(analysis.structure);

    const sectionContent = `## 시스템 아키텍처

### 계층 구조

**시스템 구성:**
- 클라이언트 계층
- API 계층
- 비즈니스 로직 계층
- 데이터 접근 계층

### 주요 컴포넌트

${structureExplanation}

### 데이터 흐름

**요청 처리 과정:**
1. 클라이언트가 HTTP 요청 전송
2. API 계층에서 요청 수신 및 검증
3. 비즈니스 로직 계층에서 처리
4. 데이터 접근 계층에서 데이터베이스 조회
5. 결과를 역순으로 반환하여 클라이언트에 응답

---

`;

    return this.controlSectionLength(sectionContent, '시스템 아키텍처');
  }

  /**
   * API 섹션 생성
   */
  generateAPISection(analysis) {
    return `## API 문서

### 엔드포인트 목록

${analysis.apiEndpoints.length > 0 ?
  analysis.apiEndpoints.map(ep => `**${ep.method} ${ep.path}**\n${ep.description || ''}`).join('\n\n')
  :
  `**GET /api/resource** - 목록 조회\n**POST /api/resource** - 생성\n**GET /api/resource/:id** - 단건 조회\n**PUT /api/resource/:id** - 수정\n**DELETE /api/resource/:id** - 삭제`
}

### 인증

\`\`\`bash
curl -H "Authorization: Bearer TOKEN" https://api.example.com/endpoint
\`\`\`

### 요청/응답 예시

\`\`\`json
// 요청
{
  "field": "value"
}

// 응답
{
  "status": "success",
  "data": {}
}
\`\`\`

---

`;
  }

  /**
   * 데이터베이스 섹션 생성
   */
  generateDatabaseSection(analysis) {
    return `## 데이터베이스

### 테이블 목록

${analysis.database.tables.length > 0 ?
  analysis.database.tables.map(table => `- **${table.name}**`).join('\n')
  :
  `- users\n- resources`
}

### 쿼리 예시

\`\`\`sql
SELECT * FROM users WHERE id = ?;
\`\`\`

---

`;
  }

  /**
   * 설치 및 설정 섹션 생성 (간결화, 인용문 활용)
   */
  generateSetupSection(analysis) {
    const sectionContent = `## 설치 및 설정

### 사전 요구사항
${this.getRequirements(analysis)}

### 설치 및 실행

기본 설치:
> \`${this.getInstallCommand(analysis)}\`

실행:
> \`${this.getRunCommand(analysis)}\`

상세 설정:
> **환경 변수 (.env):**
> - DATABASE_URL: 데이터베이스 연결 정보
> - API_KEY: API 키 설정

---

`;

    return this.controlSectionLength(sectionContent, '설치 및 설정');
  }

  /**
   * 테스트 섹션 생성
   */
  generateTestSection(analysis) {
    return `## 테스트

### 테스트 실행

\`\`\`bash
npm test
\`\`\`

### 테스트 작성 예시

\`\`\`javascript
describe('함수명', () => {
  it('정상 동작', () => {
    expect(result).toBe(expected);
  });
});
\`\`\`

### 커버리지 목표

전체 코드의 80% 이상 커버리지 유지

---
`;
  }

  /**
   * API 관련 파일이 있는지 체크
   */
  hasAPIFiles(files) {
    const apiPatterns = ['/routes/', '/controllers/', '/api/', 'router', 'endpoint'];
    return files.some(file =>
      apiPatterns.some(pattern => file.toLowerCase().includes(pattern))
    );
  }

  /**
   * DB 관련 파일이 있는지 체크
   */
  hasDatabaseFiles(files) {
    const dbPatterns = ['/models/', '/entities/', 'schema', 'migration', 'database'];
    return files.some(file =>
      dbPatterns.some(pattern => file.toLowerCase().includes(pattern))
    );
  }

  /**
   * 테스트 파일이 있는지 체크
   */
  hasTestFiles(files) {
    const testPatterns = ['.test.', '.spec.', '__tests__', '/tests/', '/test/'];
    return files.some(file =>
      testPatterns.some(pattern => file.toLowerCase().includes(pattern))
    );
  }

  /**
   * 테스트 가이드 생성
   */
  generateTestGuide(analysis, requirements = null) {
    return `# 테스트

## 실행

\`\`\`bash
npm test
\`\`\`

## 예시

\`\`\`javascript
describe('함수명', () => {
  it('정상 동작', () => {
    expect(result).toBe(expected);
  });
});
\`\`\`

## 테스트 커버리지

**목표:** 전체 코드의 80% 이상 커버리지 유지
`;
  }

  /**
   * README 생성
   */
  generateReadme(analysis, requirements = null) {
    const projectName = analysis.path.split(/[/\\]/).pop();
    const primaryLang = Object.entries(analysis.languages)
      .sort((a, b) => b[1] - a[1])[0][0];

    return `# ${projectName}

${primaryLang} 기반 프로젝트

## 설치

\`\`\`bash
${this.getInstallCommand(analysis)}
\`\`\`

## 실행

\`\`\`bash
${this.getRunCommand(analysis)}
\`\`\`

## 기술 스택

${Object.entries(analysis.languages)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 3)
  .map(([lang]) => `- ${lang}`)
  .join('\n')}
${analysis.dependencies.runtime.length > 0 ? `- ${analysis.dependencies.runtime.slice(0, 3).join(', ')}` : ''}
`;
  }

  /**
   * ARCHITECTURE 생성 (Mermaid 제거)
   */
  generateArchitecture(analysis, requirements = null) {
    const projectName = analysis.path.split(/[/\\]/).pop();

    return `# ${projectName} 아키텍처

## 시스템 구조

**계층:**
- 클라이언트
- API 계층
- 비즈니스 로직
- 데이터베이스

## 주요 컴포넌트

### 1. API 계층
- RESTful API 엔드포인트 제공
- 인증 및 권한 검증
- 요청 유효성 검사

### 2. 비즈니스 로직 계층
- 핵심 비즈니스 규칙 구현
- 데이터 가공 및 처리
- 외부 서비스 연동

### 3. 데이터 접근 계층
- 데이터베이스 연동 (ORM)
- 캐싱 전략
- 트랜잭션 관리

## 데이터 흐름

**요청 처리 과정:**
1. 클라이언트가 HTTP 요청 전송
2. API 계층에서 요청을 수신하고 유효성 검증
3. 비즈니스 로직 계층에서 실제 처리 수행
4. 필요시 데이터 접근 계층을 통해 데이터베이스 조회
5. 결과를 역순으로 반환하여 클라이언트에 응답

## 프로젝트 구조 설명

${this.explainStructure(analysis.structure)}
`;
  }

  /**
   * API 문서 생성
   */
  generateAPI(analysis, requirements = null) {
    return `# API

## 엔드포인트

${analysis.apiEndpoints.length > 0 ?
  analysis.apiEndpoints.map(ep => `**${ep.method} ${ep.path}**\n${ep.description || ''}`).join('\n\n')
  :
  `GET /api/users - 목록\nPOST /api/users - 생성\nGET /api/users/:id - 조회\nPUT /api/users/:id - 수정\nDELETE /api/users/:id - 삭제`
}

## 인증

\`\`\`bash
curl -H "Authorization: Bearer TOKEN" https://api.example.com
\`\`\`
`;
  }

  /**
   * DATABASE 문서 생성
   */
  generateDatabase(analysis, requirements = null) {
    return `# 데이터베이스

## 테이블

${analysis.database.tables.length > 0 ?
  analysis.database.tables.map(table => `- ${table.name}`).join('\n')
  :
  `- users
- posts`
}

## 쿼리 예시

\`\`\`sql
SELECT * FROM users WHERE id = ?;
\`\`\`
`;
  }

  /**
   * SETUP 문서 생성
   */
  generateSetup(analysis, requirements = null) {
    return `# 개발환경 설정

## 설치

\`\`\`bash
${this.getInstallCommand(analysis)}
\`\`\`

## 환경 변수

\`.env\` 파일:
\`\`\`
DATABASE_URL=postgresql://localhost:5432/mydb
API_KEY=your_api_key_here
\`\`\`

## 실행

\`\`\`bash
${this.getRunCommand(analysis)}
\`\`\`
`;
  }

  // === 유틸리티 함수 ===

  renderStructureTree(structure, depth = 0) {
    let result = '';
    const indent = '  '.repeat(depth);

    Object.entries(structure).forEach(([key, value]) => {
      if (key === '__files') {
        value.forEach(file => {
          result += `${indent}├── ${file}\n`;
        });
      } else {
        result += `${indent}├── ${key}/\n`;
        result += this.renderStructureTree(value, depth + 1);
      }
    });

    return result;
  }

  explainStructure(structure) {
    // 디렉토리 구조 설명
    let explanation = '### 디렉토리 설명\n\n';

    const commonDirs = {
      'src': '소스 코드 (Source Code)',
      'lib': '라이브러리 및 유틸리티',
      'dist': '빌드된 배포 파일',
      'build': '빌드 산출물',
      'test': '테스트 코드',
      'tests': '테스트 코드',
      'docs': '프로젝트 문서',
      'public': '정적 파일 (HTML, CSS, 이미지 등)',
      'config': '설정 파일',
      'scripts': '유틸리티 스크립트',
      'api': 'API 엔드포인트',
      'routes': '라우팅 정의',
      'controllers': '컨트롤러 (비즈니스 로직)',
      'models': '데이터 모델',
      'services': '서비스 계층',
      'utils': '유틸리티 함수',
      'components': 'UI 컴포넌트',
      'pages': '페이지 컴포넌트'
    };

    const dirs = Object.keys(structure).filter(key => key !== '__files');

    if (dirs.length > 0) {
      dirs.forEach(dir => {
        const desc = commonDirs[dir.toLowerCase()] || '(설명 필요)';
        explanation += `- **${dir}/**: ${desc}\n`;
      });
    } else {
      explanation = '각 디렉토리의 역할을 여기에 작성해주세요.\n';
    }

    return explanation;
  }

  getRequirements(analysis) {
    const langs = Object.keys(analysis.languages);
    if (langs.includes('JavaScript') || langs.includes('TypeScript')) {
      return '- **Node.js** 18 이상\n- **패키지 관리자**: npm 또는 yarn';
    }
    if (langs.includes('Python')) {
      return '- **Python** 3.8 이상\n- **패키지 관리자**: pip';
    }
    if (langs.includes('Java')) {
      return '- **Java** 17 이상\n- **빌드 도구**: Maven 또는 Gradle';
    }
    if (langs.includes('Go')) {
      return '- **Go** 1.20 이상';
    }
    return '- 해당 프로그래밍 언어의 런타임 환경';
  }

  getInstallCommand(analysis) {
    const langs = Object.keys(analysis.languages);
    if (langs.includes('JavaScript') || langs.includes('TypeScript')) {
      return 'npm install  # 또는 yarn install';
    }
    if (langs.includes('Python')) {
      return 'pip install -r requirements.txt  # 의존성 설치';
    }
    if (langs.includes('Java')) {
      return 'mvn install  # 또는 gradle build';
    }
    return '# 의존성 설치 명령어';
  }

  getRunCommand(analysis) {
    const langs = Object.keys(analysis.languages);
    if (langs.includes('JavaScript') || langs.includes('TypeScript')) {
      return 'npm run dev  # 개발 모드로 실행';
    }
    if (langs.includes('Python')) {
      return 'python app.py  # 애플리케이션 실행';
    }
    if (langs.includes('Java')) {
      return 'mvn spring-boot:run  # Spring Boot 실행';
    }
    if (langs.includes('Go')) {
      return 'go run main.go  # Go 애플리케이션 실행';
    }
    return '# 애플리케이션 실행 명령어';
  }

  getMigrationCommand(analysis) {
    const langs = Object.keys(analysis.languages);
    if (langs.includes('JavaScript') || langs.includes('TypeScript')) {
      return 'npm run migrate  # 데이터베이스 마이그레이션';
    }
    if (langs.includes('Python')) {
      return 'python manage.py migrate  # Django 마이그레이션';
    }
    return 'npm run migrate  # 데이터베이스 초기화';
  }

  getClearCacheCommand(analysis) {
    const langs = Object.keys(analysis.languages);
    if (langs.includes('JavaScript') || langs.includes('TypeScript')) {
      return 'rm -rf node_modules package-lock.json  # Node.js 캐시 삭제';
    }
    if (langs.includes('Python')) {
      return 'pip cache purge  # pip 캐시 삭제';
    }
    return '# 캐시 삭제 명령어';
  }

  /**
   * 문서 개선
   */
  async improveDocument(currentDocument, improvementRequest) {
    console.log('[Code Agent] 문서 개선 시작:', improvementRequest);

    // 개선 요청 분석
    const sections = this.identifyTargetSections(improvementRequest);

    // 문서 개선 수행
    let improvedDocument = currentDocument;

    if (sections.includes('api')) {
      improvedDocument = this.enhanceAPISection(improvedDocument);
    }
    if (sections.includes('architecture')) {
      improvedDocument = this.enhanceArchitectureSection(improvedDocument);
    }
    if (sections.includes('setup')) {
      improvedDocument = this.enhanceSetupSection(improvedDocument);
    }
    if (sections.includes('all')) {
      // 전체 개선
      improvedDocument = this.enhanceAllSections(improvedDocument);
    }

    return {
      success: true,
      document: improvedDocument,
      improvements: `${sections.join(', ')} 섹션 개선 완료`
    };
  }

  /**
   * 개선 대상 섹션 식별
   */
  identifyTargetSections(request) {
    const sections = [];
    const lower = request.toLowerCase();

    if (lower.includes('api')) sections.push('api');
    if (lower.includes('아키텍처') || lower.includes('architecture')) sections.push('architecture');
    if (lower.includes('설정') || lower.includes('setup') || lower.includes('설치')) sections.push('setup');
    if (lower.includes('전체') || lower.includes('모두') || lower.includes('all')) sections.push('all');

    // 기본값: 전체 개선
    if (sections.length === 0) sections.push('all');

    return sections;
  }

  /**
   * API 섹션 강화
   */
  enhanceAPISection(document) {
    // API 섹션에 예시 추가
    const apiPattern = /## API 문서[\s\S]*?(?=##|$)/;
    const match = document.match(apiPattern);

    if (match) {
      let apiSection = match[0];

      // 예시 코드가 없으면 추가
      if (!apiSection.includes('curl') && !apiSection.includes('예시')) {
        apiSection += `\n### 사용 예시\n\n`;
        apiSection += `\`\`\`bash\n# GET 요청\ncurl -X GET "https://api.example.com/resource" \\\n  -H "Authorization: Bearer TOKEN"\n\n# POST 요청\ncurl -X POST "https://api.example.com/resource" \\\n  -H "Content-Type: application/json" \\\n  -d '{"field": "value"}'\n\`\`\`\n\n`;
        apiSection += `### 응답 예시\n\n`;
        apiSection += `\`\`\`json\n{\n  "status": "success",\n  "data": {\n    "id": 1,\n    "field": "value"\n  }\n}\n\`\`\`\n\n`;
      }

      document = document.replace(apiPattern, apiSection);
    }

    return document;
  }

  /**
   * 아키텍처 섹션 강화 (Mermaid 제거)
   */
  enhanceArchitectureSection(document) {
    // 아키텍처 섹션에 더 상세한 설명 추가
    const archPattern = /## 시스템 아키텍처[\s\S]*?(?=##|$)/;
    const match = document.match(archPattern);

    if (match) {
      let archSection = match[0];

      // 컴포넌트 설명이 부족하면 추가
      if (!archSection.includes('컴포넌트 구조') && !archSection.includes('설계 패턴')) {
        const componentDescription = `\n### 설계 패턴

**적용된 패턴:**
- 계층형 아키텍처 (Layered Architecture)
- 관심사의 분리 (Separation of Concerns)
- 의존성 주입 (Dependency Injection)

**장점:**
- 유지보수성 향상
- 테스트 용이성
- 확장성 확보

`;

        archSection += componentDescription;
      }

      document = document.replace(archPattern, archSection);
    }

    return document;
  }

  /**
   * 설정 섹션 강화
   */
  enhanceSetupSection(document) {
    // 설정 섹션에 트러블슈팅 추가
    const setupPattern = /## 설치 및 설정[\s\S]*?(?=##|$)/;
    const match = document.match(setupPattern);

    if (match) {
      let setupSection = match[0];

      // 트러블슈팅이 없으면 추가
      if (!setupSection.includes('트러블슈팅') && !setupSection.includes('문제 해결')) {
        setupSection += `\n### 문제 해결\n\n`;
        setupSection += `**포트 충돌:**\n\`\`\`bash\n# 포트 사용 중인 프로세스 종료\nlsof -ti:3000 | xargs kill -9\n\`\`\`\n\n`;
        setupSection += `**의존성 오류:**\n\`\`\`bash\n# 캐시 삭제 후 재설치\nrm -rf node_modules package-lock.json\nnpm install\n\`\`\`\n\n`;
      }

      document = document.replace(setupPattern, setupSection);
    }

    return document;
  }

  /**
   * 전체 섹션 강화
   */
  enhanceAllSections(document) {
    document = this.enhanceAPISection(document);
    document = this.enhanceArchitectureSection(document);
    document = this.enhanceSetupSection(document);
    return document;
  }

  /**
   * 다이어그램 추가 (이미지 방식)
   * Mermaid 대신 이미지 링크 플레이스홀더를 삽입합니다.
   */
  async addDiagram(document, diagramRequest) {
    console.log('[Code Agent] 다이어그램 이미지 플레이스홀더 추가:', diagramRequest);

    const diagramType = this.identifyDiagramType(diagramRequest);

    // 이미지 플레이스홀더 생성
    const imagePlaceholder = this.generateImagePlaceholder(diagramType);

    // 다이어그램을 적절한 섹션에 삽입
    const targetSection = this.findTargetSection(document, diagramType);

    if (targetSection) {
      const sectionPattern = new RegExp(`## ${targetSection}[\\s\\S]*?(?=##|$)`);
      const match = document.match(sectionPattern);

      if (match) {
        let section = match[0];
        section += `\n### ${diagramType} 다이어그램\n\n${imagePlaceholder}\n\n`;
        document = document.replace(sectionPattern, section);
      }
    } else {
      // 섹션을 찾지 못하면 문서 끝에 추가
      document += `\n## ${diagramType} 다이어그램\n\n${imagePlaceholder}\n\n`;
    }

    return {
      success: true,
      document: document,
      diagramType: diagramType,
      message: `${diagramType} 다이어그램 이미지 플레이스홀더가 추가되었습니다. Image Agent로 이미지를 생성하세요.`
    };
  }

  /**
   * 다이어그램 타입 식별
   */
  identifyDiagramType(request) {
    const lower = request.toLowerCase();

    if (lower.includes('시퀀스') || lower.includes('sequence')) return '시퀀스';
    if (lower.includes('플로우') || lower.includes('흐름') || lower.includes('flowchart')) return '플로우차트';
    if (lower.includes('erd') || lower.includes('데이터베이스')) return 'ERD';
    if (lower.includes('클래스') || lower.includes('class')) return '클래스';
    if (lower.includes('컴포넌트') || lower.includes('component')) return '컴포넌트';
    if (lower.includes('아키텍처') || lower.includes('architecture')) return '아키텍처';

    return '플로우차트'; // 기본값
  }

  /**
   * 이미지 플레이스홀더 생성
   */
  generateImagePlaceholder(diagramType) {
    return `> 📋 **${diagramType} 다이어그램 이미지 필요**
>
> Image Agent를 사용하여 다음 명령으로 이미지를 생성하세요:
> \`"${diagramType} 다이어그램 이미지 만들어줘"\`
>
> 이미지 생성 후 아래 형식으로 삽입:
> \`![${diagramType} 다이어그램](이미지_URL_또는_경로)\``;
  }

  /**
   * 다이어그램 삽입 대상 섹션 찾기
   */
  findTargetSection(document, diagramType) {
    if (diagramType === 'ERD' || diagramType === '데이터베이스') {
      return '데이터베이스';
    }
    if (diagramType === '시퀀스' || diagramType === '플로우차트' || diagramType === '컴포넌트' || diagramType === '아키텍처') {
      return '시스템 아키텍처';
    }
    if (diagramType === '클래스') {
      return '시스템 아키텍처';
    }
    return null;
  }
}
