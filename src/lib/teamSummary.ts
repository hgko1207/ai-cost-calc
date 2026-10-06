// "결재용 요약 복사"에 들어갈 일반 텍스트. 사내 메신저·메일·문서에 그대로 붙여 넣는 용도.
import { krw } from './format';
import { compareAlternative, compositionText, type TeamResult } from './team';

export interface SummaryContext {
  toolName: string;
  billing: 'monthly' | 'annual';
  vat: boolean;
  fxRate: number;
  groups: { name: string; count: number; hours: number }[];
  checkedAt: string; // 가격 확인일
  url: string; // 이 결과 링크
}

export function buildTeamSummary(r: TeamResult, c: SummaryContext): string {
  const rec = r.recommended;
  if (!rec) return '';
  const vatText = c.vat ? '부가세 포함' : '부가세 별도';
  const lines = [
    `[AI 코딩 도구 도입 검토] ${c.toolName}`,
    '',
    `■ 인원: 총 ${r.headcount}명 (${c.groups.filter((g) => g.count > 0).map((g) => `${g.name} ${g.count}명·하루 ${g.hours}시간`).join(', ')})`,
    `■ 추천: ${rec.option.name} — ${compositionText(rec)}`,
    `■ 예산(${c.billing === 'annual' ? '연간 결제' : '월간 결제'}, ${vatText}): 월 ${krw(rec.monthlyKrw)} / 연 ${krw(rec.annualKrw)} / 1인당 월 ${krw(rec.perUserKrw)}`,
  ];
  const cmp = compareAlternative(r);
  if (cmp?.kind === 'vs-individual') {
    lines.push(
      cmp.monthlyDiff >= 0
        ? `■ 개인 구독을 각자 결제해 지원할 때보다 월 ${krw(cmp.monthlyDiff)}(연 ${krw(cmp.annualDiff)}) 절감, 회사 관리 기능 포함`
        : `■ 개인 구독을 각자 지원하는 것보다 월 ${krw(-cmp.monthlyDiff)}(연 ${krw(-cmp.annualDiff)}) 더 들지만, 회사 관리 기능을 쓸 수 있음`,
    );
  } else if (cmp?.kind === 'vs-team') {
    lines.push(
      `■ 회사용 요금제(${cmp.alt.option.name})로 바꾸면 월 ${krw(cmp.monthlyDiff)}(연 ${krw(cmp.annualDiff)}) 더 들지만, 회사 관리 기능(SSO·관리 콘솔 등)을 쓸 수 있음`,
    );
  }
  const others = r.options.filter((o) => o.applicable && o.option.id !== rec.option.id);
  if (others.length) lines.push(`■ 비교: ${others.map((o) => `${o.option.name} 월 ${krw(o.monthlyKrw)}`).join(', ')}`);
  lines.push(
    '',
    `※ 공식 가격(${c.checkedAt} 확인)과 사용량 가정으로 만든 추정치입니다. 달러 가격은 환율 ${c.fxRate.toLocaleString('ko-KR')}원/$, ${vatText}.`,
    `계산 링크: ${c.url}`,
  );
  return lines.join('\n');
}
