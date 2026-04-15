export type SubmitterType = "verified" | "unverified";

export type FeatureRequestRow = {
  id: string;
  title: string;
  content: string;
  vote_score: number;
  created_at: string;
  submitter_type: SubmitterType;
};

export type FeatureRequestVoteRow = {
  id: string;
  feature_request_id: string;
  vote: number;
};
