/**
 * State Manager: 대화 상태 및 세션 관리
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export class StateManager {
  constructor(stateDir = './.state') {
    this.stateDir = stateDir;
    this.sessionFile = join(stateDir, 'session.json');

    // 현재 세션 상태
    this.state = {
      projectPath: null,
      notionPages: {},        // { 'README.md': 'notion-page-id' }
      conversationHistory: [], // 대화 기록
      generatedDocs: {},      // { 'README.md': 'content...' }
      customPrompts: {},      // 수정된 프롬프트
      modifiedFiles: [],      // 최근 수정된 파일 목록
      pendingRequirements: null, // 대기 중인 요구사항 입력
      feedbackHistory: [],    // 피드백 누적 기록
      metadata: {
        createdAt: null,
        lastUpdated: null,
        version: '1.0.0'
      }
    };

    // 메모리에만 존재하는 Set (빠른 조회)
    this.modifiedFilesSet = new Set();
  }

  /**
   * 초기화
   */
  async initialize() {
    // 상태 디렉토리 생성
    if (!existsSync(this.stateDir)) {
      await mkdir(this.stateDir, { recursive: true });
    }

    // 기존 세션 로드
    await this.loadSession();
  }

  /**
   * 세션 로드
   */
  async loadSession() {
    try {
      if (existsSync(this.sessionFile)) {
        const data = await readFile(this.sessionFile, 'utf-8');
        this.state = JSON.parse(data);

        // modifiedFiles 배열을 Set으로 복원
        if (this.state.modifiedFiles) {
          this.modifiedFilesSet = new Set(this.state.modifiedFiles);
        }

        console.log('📂 이전 세션 복원됨');
      }
    } catch (error) {
      console.log('📝 새 세션 시작');
    }
  }

  /**
   * 세션 저장
   */
  async saveSession() {
    try {
      // Set을 배열로 변환하여 저장
      this.state.modifiedFiles = Array.from(this.modifiedFilesSet);
      this.state.metadata.lastUpdated = new Date().toISOString();
      await writeFile(this.sessionFile, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (error) {
      console.error('세션 저장 오류:', error.message);
    }
  }

  /**
   * 프로젝트 설정
   */
  setProject(projectPath) {
    this.state.projectPath = projectPath;
    if (!this.state.metadata.createdAt) {
      this.state.metadata.createdAt = new Date().toISOString();
    }
  }

  /**
   * 대화 추가
   */
  addConversation(userMessage, agentResponse) {
    this.state.conversationHistory.push({
      timestamp: new Date().toISOString(),
      user: userMessage,
      agent: agentResponse
    });
  }

  /**
   * Notion 페이지 ID 저장
   */
  setNotionPage(filename, pageId, pageUrl) {
    this.state.notionPages[filename] = {
      id: pageId,
      url: pageUrl,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Notion 페이지 ID 가져오기
   */
  getNotionPage(filename) {
    return this.state.notionPages[filename];
  }

  /**
   * 모든 Notion 페이지 가져오기
   */
  getAllNotionPages() {
    return this.state.notionPages;
  }

  /**
   * 문서 저장
   */
  setDocument(filename, content) {
    this.state.generatedDocs[filename] = {
      content,
      updatedAt: new Date().toISOString()
    };
    // 수정된 파일로 마킹
    this.modifiedFilesSet.add(filename);
  }

  /**
   * 문서 가져오기
   */
  getDocument(filename) {
    return this.state.generatedDocs[filename]?.content;
  }

  /**
   * 모든 문서 가져오기
   */
  getAllDocuments() {
    const docs = {};
    Object.entries(this.state.generatedDocs).forEach(([filename, data]) => {
      docs[filename] = data.content;
    });
    return docs;
  }

  /**
   * 커스텀 프롬프트 저장
   */
  setCustomPrompt(agentName, promptConfig) {
    this.state.customPrompts[agentName] = {
      ...promptConfig,
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * 커스텀 프롬프트 가져오기
   */
  getCustomPrompt(agentName) {
    return this.state.customPrompts[agentName];
  }

  /**
   * 최근 대화 가져오기
   */
  getRecentConversations(limit = 5) {
    return this.state.conversationHistory.slice(-limit);
  }

  /**
   * 상태 요약
   */
  getSummary() {
    return {
      projectPath: this.state.projectPath,
      documentsCount: Object.keys(this.state.generatedDocs).length,
      notionPagesCount: Object.keys(this.state.notionPages).length,
      conversationsCount: this.state.conversationHistory.length,
      customPromptsCount: Object.keys(this.state.customPrompts).length,
      createdAt: this.state.metadata.createdAt,
      lastUpdated: this.state.metadata.lastUpdated
    };
  }

  /**
   * 세션 리셋
   */
  async reset() {
    this.state = {
      projectPath: null,
      notionPages: {},
      conversationHistory: [],
      generatedDocs: {},
      customPrompts: {},
      modifiedFiles: [],
      pendingRequirements: null,
      feedbackHistory: [],
      metadata: {
        createdAt: null,
        lastUpdated: null,
        version: '1.0.0'
      }
    };
    this.modifiedFilesSet.clear();
    await this.saveSession();
    console.log('🔄 세션 리셋 완료');
  }

  /**
   * Notion 페이지 업데이트 시간 갱신
   */
  updateNotionPageTimestamp(filename) {
    if (this.state.notionPages[filename]) {
      this.state.notionPages[filename].lastUpdated = new Date().toISOString();
    }
  }

  /**
   * 파일을 수정됨으로 마킹
   */
  markFileAsModified(filename) {
    this.modifiedFilesSet.add(filename);
  }

  /**
   * 수정된 파일 목록 가져오기
   */
  getModifiedFiles() {
    return Array.from(this.modifiedFilesSet);
  }

  /**
   * 수정된 파일이 있는지 확인
   */
  hasModifiedFiles() {
    return this.modifiedFilesSet.size > 0;
  }

  /**
   * 수정된 파일 목록 초기화
   */
  clearModifiedFiles() {
    this.modifiedFilesSet.clear();
    this.state.modifiedFiles = [];
  }

  /**
   * 대기 중인 요구사항 저장
   */
  setPendingRequirements(requirements) {
    this.state.pendingRequirements = {
      requirements,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 대기 중인 요구사항 가져오기
   */
  getPendingRequirements() {
    return this.state.pendingRequirements;
  }

  /**
   * 대기 중인 요구사항 초기화
   */
  clearPendingRequirements() {
    this.state.pendingRequirements = null;
  }

  /**
   * 대기 중인 요구사항이 있는지 확인
   */
  hasPendingRequirements() {
    return this.state.pendingRequirements !== null;
  }

  /**
   * 피드백 추가
   */
  async addFeedback(feedbackEntry) {
    // feedbackHistory 배열이 없으면 초기화
    if (!this.state.feedbackHistory) {
      this.state.feedbackHistory = [];
    }

    // 피드백 항목 추가
    this.state.feedbackHistory.push({
      ...feedbackEntry,
      timestamp: feedbackEntry.timestamp || new Date().toISOString()
    });

    // 세션 저장
    await this.saveSession();

    console.log(`📝 피드백 저장됨: ${feedbackEntry.category || 'general'}`);
  }

  /**
   * 피드백 히스토리 가져오기
   */
  getFeedbackHistory() {
    // feedbackHistory 배열이 없으면 빈 배열 반환
    if (!this.state.feedbackHistory) {
      this.state.feedbackHistory = [];
    }
    return this.state.feedbackHistory;
  }

  /**
   * 특정 카테고리의 피드백만 가져오기
   */
  getFeedbackByCategory(category) {
    const history = this.getFeedbackHistory();
    return history.filter(entry => entry.category === category);
  }

  /**
   * 최근 피드백 가져오기
   */
  getRecentFeedback(limit = 10) {
    const history = this.getFeedbackHistory();
    return history.slice(-limit);
  }

  /**
   * 피드백 통계
   */
  getFeedbackStats() {
    const history = this.getFeedbackHistory();

    // 카테고리별 카운트
    const categoryCount = {};
    history.forEach(entry => {
      const category = entry.category || 'general';
      categoryCount[category] = (categoryCount[category] || 0) + 1;
    });

    // severity별 카운트
    const severityCount = {
      high: 0,
      medium: 0,
      low: 0
    };
    history.forEach(entry => {
      const severity = entry.severity || 'medium';
      severityCount[severity]++;
    });

    return {
      total: history.length,
      byCategory: categoryCount,
      bySeverity: severityCount,
      mostCommonCategory: Object.entries(categoryCount)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'none'
    };
  }

  /**
   * 피드백 히스토리 초기화
   */
  async clearFeedbackHistory() {
    this.state.feedbackHistory = [];
    await this.saveSession();
    console.log('🗑️ 피드백 히스토리 초기화 완료');
  }
}
