export type ReviewStatus = 'success' | 'error';

export type ReviewResult = {
  status: ReviewStatus;
  tool: string;
  message: string;
};

export type RiskLevel = 'critical' | 'high' | 'normal';
