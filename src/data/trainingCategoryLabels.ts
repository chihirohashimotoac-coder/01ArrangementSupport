/** 保存用キーは変えず、出題と履歴で共通に使う表示名だけを定める。 */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  'checkout-under-100': '100点未満の上がり',
  'checkout-100-119': '100〜119点の上がり',
  'checkout-120-149': '120〜149点の上がり',
  'checkout-150-170': '150〜170点の上がり',
  'recovery-direct': '直接の立て直し',
  'recovery-rebuild': '組み直す立て直し',
  'recovery-advanced': '応用の立て直し',
  'setup-bogey-avoid': 'ボギー回避',
  'setup-adjust-18-19-20': '18・19・20の調整',
  'setup-digits-0147': '下一桁0・1・4・7',
  'setup-302-309': '302〜309点の調整',
  'setup-ton-trap': 'TONの罠',
  'setup-landing-95-105': '95〜105点への着地',
  'setup-sbull': 'S-BULLで調整',
  'setup-same-number-worse': '同じ番号を続ける危険',
  'setup-basics': 'セットアップの基礎',
  'setup-first-dart-safety': '初手のシングル落ち耐性',
};

export function trainingCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? 'その他';
}
