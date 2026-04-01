# mcp-docs-automation

TypeScript 기반 프로젝트

## 목차

1. [프로젝트 개요](#프로젝트-개요)
2. [시스템 아키텍처](#시스템-아키텍처)
3. [API 문서](#api-문서)
4. [데이터베이스](#데이터베이스)
5. [설치 및 설정](#설치-및-설정)
6. [테스트](#테스트)

---

## 프로젝트 개요

**주요 기술:** TypeScript, JavaScript

주요 의존성:
> @modelcontextprotocol/sdk, @notionhq/client, dotenv, form-data, glob 외 5개

상세 구조:
> ```
> ├── upload-to-notion.js
├── upload-technical-ref.js
├── upload-technical-doc.js
├── upload-readme-to-notion.js
├── upload-new-guide.js
├── upload-new-docs.js
├── upload-getting-started.js
├── upload-existing-image.js
├── upload-beginner-guide.js
├── update-api-page.js
  ... (생략)
> ```

---

## 시스템 아키텍처

### 계층 구조

시스템은 다음과 같이 구성됩니다:

> **주요 계층:**
> - 클라이언트 계층
> - API 계층
> - 비즈니스 로직 계층
> - 데이터 접근 계층

### 주요 컴포넌트

### 디렉토리 설명

- **src/**: 소스 코드 (Source Code)
- **node_modules/**: (설명 필요)


### 데이터 흐름

요청은 다음 단계로 처리됩니다:

> **처리 과정:**
> 1. 클라이언트가 HTTP 요청 전송
> 2. API 계층에서 요청 수신 및 검증
> 3. 비즈니스 로직 계층에서 처리
> 4. 데이터 접근 계층에서 데이터베이스 조회
> 5. 결과를 역순으로 반환하여 클라이언트에 응답

---

## API 문서

### 엔드포인트 목록

> **GET /api/resource** - 목록 조회
> **POST /api/resource** - 생성
> **GET /api/resource/:id** - 단건 조회
> **PUT /api/resource/:id** - 수정
> **DELETE /api/resource/:id** - 삭제

### 인증

인증은 Bearer 토큰 방식을 사용합니다:

> ```bash
> curl -H "Authorization: Bearer TOKEN" https://api.example.com/endpoint
> ```

### 요청/응답 예시

> ```json
> // 요청
> {
>   "field": "value"
> }
>
> // 응답
> {
>   "status": "success",
>   "data": {}
> }
> ```

---

## 데이터베이스

### 테이블 목록

> - users
> - resources

### 쿼리 예시

> ```sql
> SELECT * FROM users WHERE id = ?;
> ```

---

## 설치 및 설정

### 사전 요구사항
- **Node.js** 18 이상
- **패키지 관리자**: npm 또는 yarn

### 설치 및 실행

기본 설치:
> `npm install  # 또는 yarn install`

실행:
> `npm run dev  # 개발 모드로 실행`

상세 설정:
> **환경 변수 (.env):**
> - DATABASE_URL: 데이터베이스 연결 정보
> - API_KEY: API 키 설정

---

## 테스트

### 테스트 실행

> ```bash
> npm test
> ```

### 테스트 작성 예시

> ```javascript
> describe('함수명', () => {
>   it('정상 동작', () => {
>     expect(result).toBe(expected);
>   });
> });
> ```

### 커버리지 목표

> 전체 코드의 80% 이상 커버리지 유지

---
