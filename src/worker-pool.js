/**
 * Worker Pool: 에이전트 워커 관리
 * 각 에이전트를 독립된 Worker Thread로 실행하고 작업 분배
 */

import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class WorkerPool {
  constructor(config = {}) {
    this.config = config;
    this.workers = new Map(); // agentType -> Worker
    this.taskQueue = new Map(); // taskId -> { resolve, reject, timeout }
    this.taskIdCounter = 0;
    this.workerIdCounter = 0;

    // 워커별 설정
    this.workerConfigs = {
      CODE: { count: 1 }, // 코드 분석은 1개 워커
      REVIEW: { count: 1 }, // 리뷰는 1개 워커
      IMAGE: { count: 1 }, // 이미지 생성은 1개 워커
      NOTION: { count: 1 }  // Notion 업로드는 1개 워커
    };

    console.log('[WorkerPool] 초기화됨 (각 에이전트별 독립 세션)');
  }

  /**
   * 워커 풀 초기화
   */
  async initialize() {
    console.log('[WorkerPool] 워커 생성 중...');

    const workerPromises = [];

    for (const [agentType, config] of Object.entries(this.workerConfigs)) {
      for (let i = 0; i < config.count; i++) {
        workerPromises.push(this.createWorker(agentType));
      }
    }

    await Promise.all(workerPromises);

    console.log(`[WorkerPool] ${this.workers.size}개 워커 준비 완료`);
  }

  /**
   * 워커 생성
   */
  async createWorker(agentType) {
    const workerId = ++this.workerIdCounter;
    const workerPath = join(__dirname, 'workers', 'agent-worker.js');

    const worker = new Worker(workerPath, {
      workerData: {
        agentType,
        workerId,
        config: this.config
      }
    });

    // 워커 준비 완료 대기
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Worker ${workerId} (${agentType}) 초기화 타임아웃`));
      }, 10000);

      worker.once('message', (message) => {
        if (message.type === 'ready') {
          clearTimeout(timeout);
          console.log(`[WorkerPool] Worker ${workerId} (${agentType}) 준비 완료`);
          resolve();
        }
      });

      worker.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // 메시지 수신 핸들러
    worker.on('message', (message) => {
      if (message.type === 'ready') return; // 이미 처리됨

      const { taskId, success, result, error } = message;

      const task = this.taskQueue.get(taskId);
      if (!task) {
        console.warn(`[WorkerPool] Unknown taskId: ${taskId}`);
        return;
      }

      clearTimeout(task.timeout);
      this.taskQueue.delete(taskId);

      if (success) {
        task.resolve(result);
      } else {
        task.reject(new Error(error.message));
      }
    });

    // 에러 핸들러
    worker.on('error', (error) => {
      console.error(`[WorkerPool] Worker ${workerId} (${agentType}) 에러:`, error);
      // TODO: 워커 재시작 로직
    });

    // 종료 핸들러
    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[WorkerPool] Worker ${workerId} (${agentType}) 비정상 종료: ${code}`);
      }
    });

    // 워커 저장
    if (!this.workers.has(agentType)) {
      this.workers.set(agentType, []);
    }
    this.workers.get(agentType).push({ worker, workerId, agentType, busy: false });

    return worker;
  }

  /**
   * 에이전트 메서드 호출 (워커에 작업 할당)
   */
  async callAgent(agentType, method, args, timeout = 60000) {
    const workers = this.workers.get(agentType);
    if (!workers || workers.length === 0) {
      throw new Error(`No worker available for agent type: ${agentType}`);
    }

    // 사용 가능한 워커 찾기 (현재는 1개씩만 있지만 확장 가능)
    const workerInfo = workers.find(w => !w.busy) || workers[0];
    const { worker, workerId } = workerInfo;

    const taskId = ++this.taskIdCounter;

    console.log(`[WorkerPool] Task ${taskId} 할당: ${agentType}.${method}() -> Worker ${workerId}`);

    return new Promise((resolve, reject) => {
      // 타임아웃 설정
      const timeoutId = setTimeout(() => {
        this.taskQueue.delete(taskId);
        reject(new Error(`Task ${taskId} timeout (${timeout}ms)`));
      }, timeout);

      // 작업 큐에 추가
      this.taskQueue.set(taskId, { resolve, reject, timeout: timeoutId });

      // 워커에 작업 전송
      workerInfo.busy = true;
      worker.postMessage({
        taskId,
        method,
        args
      });

      // 작업 완료 시 busy 플래그 해제
      const originalResolve = resolve;
      const originalReject = reject;

      this.taskQueue.get(taskId).resolve = (result) => {
        workerInfo.busy = false;
        originalResolve(result);
      };

      this.taskQueue.get(taskId).reject = (error) => {
        workerInfo.busy = false;
        originalReject(error);
      };
    });
  }

  /**
   * 모든 워커 종료
   */
  async terminateAll() {
    console.log('[WorkerPool] 모든 워커 종료 중...');

    const terminatePromises = [];

    for (const workers of this.workers.values()) {
      for (const { worker } of workers) {
        terminatePromises.push(worker.terminate());
      }
    }

    await Promise.all(terminatePromises);
    this.workers.clear();

    console.log('[WorkerPool] 모든 워커 종료됨');
  }

  /**
   * 통계 정보
   */
  getStats() {
    const stats = {
      totalWorkers: 0,
      busyWorkers: 0,
      pendingTasks: this.taskQueue.size,
      workersByType: {}
    };

    for (const [agentType, workers] of this.workers.entries()) {
      stats.totalWorkers += workers.length;
      stats.busyWorkers += workers.filter(w => w.busy).length;
      stats.workersByType[agentType] = {
        total: workers.length,
        busy: workers.filter(w => w.busy).length
      };
    }

    return stats;
  }
}
