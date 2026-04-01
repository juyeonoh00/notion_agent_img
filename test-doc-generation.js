#!/usr/bin/env node

/**
 * 문서 생성 직접 테스트
 */

import { CodeAgent } from './src/agents/code-agent.js';
import { ImageAgent } from './src/agents/image-agent.js';
import fs from 'fs';

console.log('🧪 문서 생성 테스트 시작...\n');

// Code Agent 생성
const codeAgent = new CodeAgent();
const imageAgent = new ImageAgent();

// 현재 프로젝트로 문서 생성
const result = await codeAgent.generateDocs(process.cwd());

console.log(`\n✅ ${Object.keys(result.files).length}개 문서 생성 완료\n`);

// 생성된 문서 확인
for (const [filename, content] of Object.entries(result.files)) {
  console.log(`📄 ${filename}:`);
  console.log(`   길이: ${content.length}자`);

  // > 문자 확인
  const blockquoteCount = (content.match(/^>/gm) || []).length;
  console.log(`   Blockquote(>) 사용: ${blockquoteCount}줄`);

  // 첫 500자 출력
  console.log(`\n   [첫 500자 미리보기]:`);
  console.log(content.substring(0, 500).split('\n').map(line => `   ${line}`).join('\n'));
  console.log(`\n`);

  // 테스트 파일로 저장
  fs.writeFileSync(`./TEST_${filename}`, content);
  console.log(`   💾 저장: TEST_${filename}\n`);
}

// 이미지 생성 테스트
console.log('🎨 이미지 생성 테스트...\n');
const imageResult = await imageAgent.generateImagesForDocuments(result.files);
console.log(`   감지된 이미지: ${imageResult.images.length}개\n`);

if (imageResult.images.length > 0) {
  imageResult.images.forEach((img, idx) => {
    console.log(`   ${idx + 1}. ${img.title}`);
    console.log(`      타입: ${img.type}`);
    console.log(`      파일: ${img.filename}`);
  });
} else {
  console.log('   ❌ 이미지가 생성되지 않았습니다!');
  console.log('   워크플로우 단계가 3개 미만이거나 감지되지 않았습니다.');
}

console.log('\n✅ 테스트 완료!');
console.log('TEST_*.md 파일들을 확인해보세요.');
