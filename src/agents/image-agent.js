/**
 * Image Agent: SVG 다이어그램 직접 생성
 *
 * 역할: 문서용 SVG 다이어그램 자동 생성
 * 출력: generated-images/ 폴더에 SVG 파일 저장
 */

import fs from 'fs';
import path from 'path';

export class ImageAgent {
  constructor(config = {}) {
    this.outputDir = config.outputDir || './generated-images';

    // 출력 디렉토리 생성
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * SVG 다이어그램 생성
   */
  async generateSVG(request) {
    console.log('[Image Agent] SVG 생성:', request);

    const { type, title, description, data } = request;

    // 타입별 SVG 생성
    let svgContent;
    let filename;

    switch (type) {
      case 'architecture':
        svgContent = this.createArchitectureSVG(title, description, data);
        filename = 'system-architecture.svg';
        break;
      case 'workflow':
      case 'flowchart':
        svgContent = this.createWorkflowSVG(title, description, data);
        filename = 'workflow-diagram.svg';
        break;
      case 'sequence':
        svgContent = this.createSequenceSVG(title, description, data);
        filename = 'sequence-diagram.svg';
        break;
      default:
        svgContent = this.createGenericDiagramSVG(title, description, data);
        filename = 'diagram.svg';
    }

    // SVG 파일 저장
    const filepath = path.join(this.outputDir, filename);
    fs.writeFileSync(filepath, svgContent);

    console.log(`[Image Agent] SVG 저장 완료: ${filepath}`);

    return {
      success: true,
      title: title,
      type: type,
      filename: filename,
      filepath: filepath,
      relativePath: `./generated-images/${filename}`
    };
  }

  /**
   * 시스템 아키텍처 SVG 생성
   */
  createArchitectureSVG(title, description, data) {
    const steps = data?.steps || ['Component 1', 'Component 2', 'Component 3'];
    const width = 1200;
    const height = 100 + (steps.length * 100);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .box { fill: #1e3a8a; stroke: #3b82f6; stroke-width: 2; rx: 8; }
      .text { fill: white; font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; font-weight: 600; text-anchor: middle; }
      .title { fill: white; font-family: 'Segoe UI', Arial, sans-serif; font-size: 20px; font-weight: 700; text-anchor: middle; }
      .arrow { stroke: #60a5fa; stroke-width: 2; fill: none; marker-end: url(#arrowhead); }
    </style>
    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <polygon points="0 0, 10 3, 0 6" fill="#60a5fa" />
    </marker>
  </defs>
  <rect width="${width}" height="${height}" fill="#0f172a"/>
  <text x="${width/2}" y="40" class="title">${title}</text>
  ${steps.map((step, i) => `
  <rect x="300" y="${80 + i*100}" width="600" height="70" class="box"/>
  <text x="${width/2}" y="${120 + i*100}" class="text">${step}</text>
  ${i < steps.length - 1 ? `<path d="M ${width/2} ${150 + i*100} L ${width/2} ${180 + i*100}" class="arrow"/>` : ''}
  `).join('')}
</svg>`;
  }

  /**
   * 워크플로우 SVG 생성
   */
  createWorkflowSVG(title, description, data) {
    const steps = data?.steps || ['Step 1', 'Step 2', 'Step 3'];
    const width = 900;
    const height = 100 + (steps.length * 120);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .step-box { fill: #1e40af; stroke: #3b82f6; stroke-width: 2; rx: 6; }
      .step-text { fill: white; font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; font-weight: 500; text-anchor: middle; }
      .title-text { fill: white; font-family: 'Segoe UI', Arial, sans-serif; font-size: 20px; font-weight: 700; text-anchor: middle; }
      .arrow { stroke: #60a5fa; stroke-width: 2; fill: none; marker-end: url(#arrowhead); }
      .num-circle { fill: #7c3aed; stroke: #a78bfa; stroke-width: 2; }
      .num-text { fill: white; font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; font-weight: 700; text-anchor: middle; }
    </style>
    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <polygon points="0 0, 10 3, 0 6" fill="#60a5fa" />
    </marker>
  </defs>
  <rect width="${width}" height="${height}" fill="#0f172a"/>
  <text x="${width/2}" y="40" class="title-text">${title}</text>
  ${steps.map((step, i) => `
  <circle cx="70" cy="${90 + i*120}" r="18" class="num-circle"/>
  <text x="70" y="${96 + i*120}" class="num-text">${i+1}</text>
  <rect x="120" y="${70 + i*120}" width="660" height="60" class="step-box"/>
  <text x="450" y="${105 + i*120}" class="step-text">${step}</text>
  ${i < steps.length - 1 ? `<path d="M 450 ${130 + i*120} L 450 ${190 + i*120}" class="arrow"/>` : ''}
  `).join('')}
</svg>`;
  }

  /**
   * 시퀀스 다이어그램 SVG 생성
   */
  createSequenceSVG(title, description, data) {
    return this.createWorkflowSVG(title, description, data);
  }

  /**
   * 일반 다이어그램 SVG 생성
   */
  createGenericDiagramSVG(title, description, data) {
    return this.createArchitectureSVG(title, description, data);
  }

  /**
   * 여러 SVG 일괄 생성
   */
  async generateMultipleSVGs(requests) {
    console.log(`[Image Agent] ${requests.length}개 SVG 생성`);

    const results = [];

    for (const request of requests) {
      try {
        const result = await this.generateSVG(request);
        results.push(result);
      } catch (error) {
        console.error(`[Image Agent] SVG 생성 실패:`, error);
        results.push({
          success: false,
          title: request.title,
          error: error.message
        });
      }
    }

    return {
      success: true,
      images: results,
      count: results.length
    };
  }

  /**
   * 문서에서 필요한 이미지 자동 감지 및 데이터 추출
   */
  detectRequiredImages(documents) {
    const imageRequests = [];

    for (const [filename, content] of Object.entries(documents)) {
      // 워크플로우 패턴 감지 (복잡한 단계적 설명)
      const steps = this.extractWorkflowSteps(content);
      if (steps.length >= 3) {
        imageRequests.push({
          type: 'workflow',
          title: '워크플로우 다이어그램',
          description: 'Process workflow showing step-by-step execution',
          data: { steps: steps.slice(0, 10) },
          targetFile: filename,
          section: '워크플로우'
        });
      }

      // 아키텍처 섹션 감지
      if (content.includes('## 시스템 아키텍처') || content.includes('## System Architecture') ||
          content.includes('## 아키텍처') || content.includes('## Architecture')) {
        const components = this.extractComponents(content);
        if (components.length > 0) {
          imageRequests.push({
            type: 'architecture',
            title: '시스템 아키텍처',
            description: 'System architecture showing components and their relationships',
            data: { steps: components.slice(0, 8) },
            targetFile: filename,
            section: '시스템 아키텍처'
          });
        }
      }
    }

    return imageRequests;
  }

  /**
   * 텍스트에서 워크플로우 단계 추출 (blockquote 지원)
   */
  extractWorkflowSteps(text) {
    const steps = [];

    // blockquote 제거한 텍스트 (패턴 매칭용)
    const withoutBlockquote = text.replace(/^>\s*/gm, '');

    // 번호가 있는 리스트 항목 추출 (1. 2. 3.) - blockquote 안팎 모두
    const numberedMatches = withoutBlockquote.match(/(?:^|\n)\d+\.\s+(.+?)(?=\n|$)/gm);
    if (numberedMatches) {
      numberedMatches.forEach(match => {
        const step = match.replace(/^\d+\.\s+/, '').replace(/\*\*/g, '').trim();
        if (step.length > 0 && step.length < 100 && !step.startsWith('#')) {
          steps.push(step);
        }
      });
    }

    // 화살표로 연결된 단계 추출
    if (steps.length < 3) {
      const arrowLines = text.split('\n').filter(line =>
        line.includes('→') || line.includes('↓') || line.includes('->') || line.includes('➡')
      );

      arrowLines.forEach(line => {
        const parts = line.split(/→|↓|->|➡/);
        parts.forEach(part => {
          const step = part.replace(/\*\*/g, '').replace(/`/g, '').replace(/^>\s*/, '').trim();
          if (step.length > 3 && step.length < 100 && !step.startsWith('#')) {
            steps.push(step);
          }
        });
      });
    }

    console.log(`[Image Agent] 추출된 워크플로우 단계: ${steps.length}개`);
    if (steps.length > 0) {
      console.log(`  첫 번째 단계: "${steps[0]}"`);
    }

    // 중복 제거
    return [...new Set(steps)];
  }

  /**
   * 텍스트에서 컴포넌트/계층 추출 (blockquote 지원)
   */
  extractComponents(text) {
    const components = [];

    // blockquote 제거
    const withoutBlockquote = text.replace(/^>\s*/gm, '');

    // 헤딩 레벨 3, 4 추출 (###, ####)
    const headingMatches = withoutBlockquote.match(/(?:^|\n)###?\s+(.+?)(?=\n|$)/gm);
    if (headingMatches) {
      headingMatches.forEach(match => {
        const component = match.replace(/^###?\s+/, '').replace(/\*\*/g, '').trim();
        if (component.length > 0 && component.length < 50) {
          components.push(component);
        }
      });
    }

    // 불릿 포인트 추출 (blockquote 안팎 모두)
    if (components.length < 3) {
      const bulletMatches = withoutBlockquote.match(/(?:^|\n)[-*]\s+\*?\*?(.+?)(?=\n|$)/gm);
      if (bulletMatches) {
        bulletMatches.forEach(match => {
          const component = match.replace(/^[-*]\s+\*?\*?/, '').trim();
          if (component.length > 0 && component.length < 50) {
            components.push(component);
          }
        });
      }
    }

    console.log(`[Image Agent] 추출된 컴포넌트: ${components.length}개`);
    if (components.length > 0) {
      console.log(`  첫 번째 컴포넌트: "${components[0]}"`);
    }

    // 중복 제거
    return [...new Set(components)];
  }

  /**
   * 여러 SVG 자동 생성 (문서용)
   */
  async generateImagesForDocuments(documents) {
    console.log('[Image Agent] 문서에 필요한 이미지 자동 감지 중...');

    const imageRequests = this.detectRequiredImages(documents);

    if (imageRequests.length === 0) {
      console.log('[Image Agent] 필요한 이미지 없음');
      return {
        success: true,
        images: [],
        message: '생성할 이미지가 없습니다.'
      };
    }

    console.log(`[Image Agent] ${imageRequests.length}개 SVG 생성 중...`);

    const results = [];

    for (const request of imageRequests) {
      const svgResult = await this.generateSVG(request);
      results.push({
        ...svgResult,
        targetFile: request.targetFile,
        section: request.section
      });
    }

    return {
      success: true,
      images: results,
      count: results.length,
      message: `${results.length}개 SVG 이미지 생성 완료`
    };
  }
}
