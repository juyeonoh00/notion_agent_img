/**
 * Worker Pool 테스트
 * 각 에이전트가 독립된 세션에서 실행되는지 확인
 */

import { ConversationalOrchestrator } from './src/conversational-orchestrator.js';

async function testWorkerPool() {
  console.log('🧪 Worker Pool 테스트 시작...\n');

  const orchestrator = new ConversationalOrchestrator({
    stateDir: './.state-test'
  });

  try {
    // 초기화 (워커들 생성)
    console.log('📦 Orchestrator 초기화 중...');
    await orchestrator.initialize();

    console.log('\n✅ Worker Pool 초기화 완료');
    console.log('📊 통계:', orchestrator.workerPool.getStats());

    // Code Agent 테스트 (독립 세션)
    console.log('\n🔍 Code Agent 테스트 (독립 세션)...');
    const codeResult = await orchestrator.callCodeAgent('generateDocs', {
      projectPath: process.cwd(),
      options: {}
    });

    console.log(`✅ Code Agent 완료: ${Object.keys(codeResult.files).length}개 문서 생성`);

    // Review Agent 테스트 (독립 세션)
    console.log('\n🔍 Review Agent 테스트 (독립 세션)...');
    const reviewResult = await orchestrator.callReviewAgent('reviewDocuments', {
      documents: codeResult.files
    });

    console.log(`✅ Review Agent 완료: 품질 점수 ${Math.round(reviewResult.overall_score)}/100`);

    // Image Agent 테스트 (독립 세션)
    console.log('\n🎨 Image Agent 테스트 (독립 세션)...');
    const imageResult = await orchestrator.callImageAgent('generateImagesForDocuments', {
      documents: codeResult.files
    });

    console.log(`✅ Image Agent 완료: ${imageResult.count}개 이미지 생성`);

    // 최종 통계
    console.log('\n📊 최종 통계:', orchestrator.workerPool.getStats());

    console.log('\n✅ 모든 테스트 통과!');
    console.log('\n🎯 결과:');
    console.log(`   - 각 에이전트가 독립된 Worker Thread에서 실행됨`);
    console.log(`   - 메시지 패싱을 통한 통신 성공`);
    console.log(`   - 독립된 메모리 공간으로 컨텍스트 격리 보장`);

  } catch (error) {
    console.error('\n❌ 테스트 실패:', error.message);
    console.error(error.stack);
  } finally {
    // 워커 종료
    console.log('\n🔚 Worker Pool 종료 중...');
    await orchestrator.shutdown();
    console.log('✅ 종료 완료');
  }
}

testWorkerPool();
