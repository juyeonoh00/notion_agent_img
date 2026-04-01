/**
 * Agent Worker: 독립된 세션에서 에이전트 실행
 * Worker Threads를 사용하여 각 에이전트를 격리된 환경에서 실행
 */

import { parentPort, workerData } from 'worker_threads';
import { CodeAgent } from '../agents/code-agent.js';
import { ReviewAgent } from '../agents/review-agent.js';
import { ImageAgent } from '../agents/image-agent.js';
import { NotionAgent } from '../agents/notion-agent.js';
import { PromptAgent } from '../agents/prompt-agent.js';

// Worker 정보
const { agentType, workerId, config } = workerData;

console.error(`[Worker ${workerId}] ${agentType} Agent 시작됨 (독립 세션)`);

// 에이전트 인스턴스 생성 (독립된 메모리 공간)
let agent;
switch (agentType) {
  case 'CODE':
    agent = new CodeAgent();
    break;
  case 'REVIEW':
    agent = new ReviewAgent();
    break;
  case 'IMAGE':
    agent = new ImageAgent(config);
    break;
  case 'NOTION':
    agent = new NotionAgent(config?.notionApiKey);
    break;
  case 'PROMPT':
    // PromptAgent는 StateManager가 필요하므로 특별 처리
    agent = { type: 'PROMPT', requiresStateManager: true };
    break;
  default:
    throw new Error(`Unknown agent type: ${agentType}`);
}

// 메시지 수신 (메인 스레드로부터)
parentPort.on('message', async (message) => {
  const { taskId, method, args } = message;

  try {
    console.error(`[Worker ${workerId}] Task ${taskId}: ${agentType}.${method}() 실행 중...`);

    let result;

    // 메서드 호출
    switch (agentType) {
      case 'CODE':
        if (method === 'generateDocs') {
          result = await agent.generateDocs(args.projectPath, args.options);
        } else if (method === 'analyzeProject') {
          result = await agent.analyzeProject(args.projectPath);
        } else if (method === 'improveDocument') {
          result = await agent.improveDocument(args.document, args.improvement);
        }
        break;

      case 'REVIEW':
        if (method === 'reviewDocuments') {
          result = await agent.reviewDocuments(args.documents);
        }
        break;

      case 'IMAGE':
        if (method === 'generateSVG') {
          result = await agent.generateSVG(args.request);
        } else if (method === 'generateImagesForDocuments') {
          result = await agent.generateImagesForDocuments(args.documents);
        } else if (method === 'detectRequiredImages') {
          result = agent.detectRequiredImages(args.documents);
        } else if (method === 'generateImagePrompt') {
          result = await agent.generateImagePrompt(args.request || args);
        }
        break;

      case 'NOTION':
        if (method === 'uploadDocument') {
          result = await agent.uploadDocument(args.document, args.options);
        } else if (method === 'uploadMultipleDocuments') {
          result = await agent.uploadMultipleDocuments(args.documents, args.options);
        } else if (method === 'createNotionPages') {
          result = await agent.createNotionPages(args.docs, args.options);
        } else if (method === 'syncToNotion') {
          // StateManager가 필요하므로 메인 스레드에서 처리해야 함
          throw new Error('syncToNotion은 워커에서 실행할 수 없습니다 (StateManager 필요)');
        } else if (method === 'syncFromNotion') {
          throw new Error('syncFromNotion은 워커에서 실행할 수 없습니다 (StateManager 필요)');
        }
        break;

      case 'PROMPT':
        // PromptAgent는 StateManager가 필요하므로 메인 스레드에서 처리
        throw new Error('PromptAgent는 워커에서 실행할 수 없습니다 (StateManager 필요)');

      default:
        throw new Error(`Unknown method: ${agentType}.${method}`);
    }

    console.error(`[Worker ${workerId}] Task ${taskId}: 완료`);

    // 결과 전송
    parentPort.postMessage({
      taskId,
      success: true,
      result
    });

  } catch (error) {
    console.error(`[Worker ${workerId}] Task ${taskId}: 에러 -`, error.message);

    // 에러 전송
    parentPort.postMessage({
      taskId,
      success: false,
      error: {
        message: error.message,
        stack: error.stack
      }
    });
  }
});

// Worker 준비 완료 신호
parentPort.postMessage({
  type: 'ready',
  workerId,
  agentType
});

console.error(`[Worker ${workerId}] 메시지 대기 중...`);
