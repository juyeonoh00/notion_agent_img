/**
 * Prompt Agent: Agent 프롬프트 동적 수정
 */

import { PROMPTS } from '../utils/prompt-templates.js';

export class PromptAgent {
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.availableAgents = ['CODE_AGENT', 'REVIEW_AGENT', 'NOTION_AGENT', 'IMAGE_AGENT'];
  }

  /**
   * 프롬프트 수정 요청 분석
   */
  async modifyPrompt(request) {
    console.log('[Prompt Agent] 프롬프트 수정 요청 분석 중...');

    const { agentName, modification, userRequest } = request;

    // Agent 이름 정규화
    const normalizedAgent = this.normalizeAgentName(agentName);

    if (!normalizedAgent) {
      return {
        success: false,
        error: `알 수 없는 Agent: ${agentName}. 사용 가능한 Agent: ${this.availableAgents.join(', ')}`
      };
    }

    // 현재 프롬프트 가져오기
    const currentPrompt = this.getCurrentPrompt(normalizedAgent);

    // 수정 사항 적용
    const modifiedPrompt = await this.applyModification(
      normalizedAgent,
      currentPrompt,
      modification || userRequest
    );

    // 상태에 저장
    this.stateManager.setCustomPrompt(normalizedAgent, modifiedPrompt);
    await this.stateManager.saveSession();

    // 수정된 내용 추출
    const modificationContent = this.extractContent(modification || userRequest);
    const modificationType = this.detectModificationType(modification || userRequest);

    return {
      success: true,
      agentName: normalizedAgent,
      before: currentPrompt,
      after: modifiedPrompt,
      message: `✅ ${normalizedAgent}에 "${modificationContent}"내용을 추가하였습니다.`
    };
  }

  /**
   * Agent 이름 정규화
   */
  normalizeAgentName(name) {
    const normalized = name.toUpperCase().replace(/\s+/g, '_');

    const mapping = {
      'CODE': 'CODE_AGENT',
      'CODE_AGENT': 'CODE_AGENT',
      'REVIEW': 'REVIEW_AGENT',
      'REVIEW_AGENT': 'REVIEW_AGENT',
      'NOTION': 'NOTION_AGENT',
      'NOTION_AGENT': 'NOTION_AGENT',
      'IMAGE': 'IMAGE_AGENT',
      'IMAGE_AGENT': 'IMAGE_AGENT',
      'DIAGRAM': 'IMAGE_AGENT',
      '코드': 'CODE_AGENT',
      '리뷰': 'REVIEW_AGENT',
      '노션': 'NOTION_AGENT',
      '이미지': 'IMAGE_AGENT',
      '다이어그램': 'IMAGE_AGENT'
    };

    return mapping[normalized] || null;
  }

  /**
   * 현재 프롬프트 가져오기
   */
  getCurrentPrompt(agentName) {
    // 커스텀 프롬프트가 있으면 그걸 반환
    const custom = this.stateManager.getCustomPrompt(agentName);
    if (custom) {
      return custom;
    }

    // 기본 프롬프트 반환
    const defaultPrompt = PROMPTS[agentName];
    return {
      system: defaultPrompt?.system || '',
      task: defaultPrompt?.task ? defaultPrompt.task.toString() : '',
      isDefault: true
    };
  }

  /**
   * 수정 사항 적용
   */
  async applyModification(agentName, currentPrompt, modification) {
    const modType = this.detectModificationType(modification);

    let newPrompt = { ...currentPrompt };

    switch (modType) {
      case 'add':
        newPrompt = this.addToPrompt(currentPrompt, modification);
        break;

      case 'remove':
        newPrompt = this.removeFromPrompt(currentPrompt, modification);
        break;

      case 'replace':
        newPrompt = this.replacePrompt(currentPrompt, modification);
        break;

      case 'enhance':
        newPrompt = this.enhancePrompt(currentPrompt, modification);
        break;

      default:
        // 일반적인 추가
        newPrompt = this.addToPrompt(currentPrompt, modification);
    }

    newPrompt.isDefault = false;
    return newPrompt;
  }

  /**
   * 수정 타입 감지
   */
  detectModificationType(modification) {
    const text = modification.toLowerCase();

    if (text.includes('추가') || text.includes('add') || text.includes('포함')) {
      return 'add';
    }
    if (text.includes('제거') || text.includes('remove') || text.includes('빼')) {
      return 'remove';
    }
    if (text.includes('교체') || text.includes('replace') || text.includes('바꿔')) {
      return 'replace';
    }
    if (text.includes('더 자세') || text.includes('상세') || text.includes('enhance')) {
      return 'enhance';
    }

    return 'add';
  }

  /**
   * 프롬프트에 추가
   */
  addToPrompt(current, addition) {
    // 추가할 내용 추출
    const content = this.extractContent(addition);

    return {
      system: current.system + `\n\n추가 지시사항: ${content}`,
      task: current.task,
      modifications: [
        ...(current.modifications || []),
        {
          type: 'add',
          content,
          timestamp: new Date().toISOString()
        }
      ]
    };
  }

  /**
   * 프롬프트에서 제거
   */
  removeFromPrompt(current, removal) {
    const content = this.extractContent(removal);

    // 간단한 제거 (정확한 매칭은 어려우므로 표시만)
    return {
      system: current.system + `\n\n제외 사항: ${content}을(를) 제외하고 작업해주세요.`,
      task: current.task,
      modifications: [
        ...(current.modifications || []),
        {
          type: 'remove',
          content,
          timestamp: new Date().toISOString()
        }
      ]
    };
  }

  /**
   * 프롬프트 교체
   */
  replacePrompt(current, replacement) {
    const content = this.extractContent(replacement);

    return {
      system: content,
      task: current.task,
      modifications: [
        {
          type: 'replace',
          content,
          timestamp: new Date().toISOString()
        }
      ]
    };
  }

  /**
   * 프롬프트 강화
   */
  enhancePrompt(current, enhancement) {
    const content = this.extractContent(enhancement);

    return {
      system: current.system + `\n\n강화 지시사항: ${content}에 대해 매우 상세하고 깊이 있게 분석해주세요.`,
      task: current.task,
      modifications: [
        ...(current.modifications || []),
        {
          type: 'enhance',
          content,
          timestamp: new Date().toISOString()
        }
      ]
    };
  }

  /**
   * 내용 추출
   */
  extractContent(text) {
    // "Code Agent가 보안도 체크하게 해줘" → "보안도 체크"
    // "더 자세하게" → "더 자세하게"

    // 핵심 내용만 추출 (간단한 버전)
    const keywords = ['추가', 'add', '제거', 'remove', '더', '포함', 'include'];

    let content = text;
    keywords.forEach(keyword => {
      content = content.replace(new RegExp(keyword, 'gi'), '');
    });

    return content.trim();
  }

  /**
   * 프롬프트 리셋
   */
  async resetPrompt(agentName) {
    const normalizedAgent = this.normalizeAgentName(agentName);

    if (!normalizedAgent) {
      return {
        success: false,
        error: `알 수 없는 Agent: ${agentName}`
      };
    }

    // 상태에서 제거
    delete this.stateManager.state.customPrompts[normalizedAgent];
    await this.stateManager.saveSession();

    return {
      success: true,
      message: `${normalizedAgent} 프롬프트가 기본값으로 리셋되었습니다.`
    };
  }

  /**
   * 모든 프롬프트 상태 보기
   */
  listPrompts() {
    const prompts = {};

    this.availableAgents.forEach(agentName => {
      const current = this.getCurrentPrompt(agentName);
      prompts[agentName] = {
        isCustom: !current.isDefault,
        modificationsCount: current.modifications?.length || 0,
        lastModified: current.modifications?.[current.modifications.length - 1]?.timestamp
      };
    });

    return prompts;
  }
}
