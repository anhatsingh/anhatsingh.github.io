/*
  GitHub GraphQL documents.

  Why GraphQL and not REST: the contribution calendar exists ONLY in v4. There is
  no REST equivalent — /users/{u}/events/public is capped at 300 events / 90 days
  and misses private and squashed work entirely.

  Consequence: this needs a token. GraphQL 401s on unauthenticated requests,
  unlike REST which allows 60/hr anonymously. A classic PAT with NO scopes is
  enough for public data; add read:user if restrictedContributionsCount should
  reflect private work.
*/

/** Costs 1 rate-limit point. from/to must span no more than one year. */
export const CONTRIBUTIONS_QUERY = /* GraphQL */ `
  query Contributions($login: String!, $from: DateTime, $to: DateTime) {
    user(login: $login) {
      createdAt
      followers {
        totalCount
      }
      contributionsCollection(from: $from, to: $to) {
        restrictedContributionsCount
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalRepositoriesWithContributedCommits
        contributionYears
        contributionCalendar {
          totalContributions
          weeks {
            firstDay
            contributionDays {
              date
              weekday
              contributionCount
              contributionLevel
            }
          }
        }
      }
      repositories(
        first: 100
        isFork: false
        privacy: PUBLIC
        ownerAffiliations: OWNER
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        totalCount
        nodes {
          name
          url
          description
          pushedAt
          primaryLanguage {
            name
            color
          }
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node {
                name
                color
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Merged-PR counts. The second number — PRs merged into repos Anhat does NOT
 * own — is the single most credible stat for someone without many stars.
 */
export const MERGED_PRS_QUERY = /* GraphQL */ `
  query MergedPrs($all: String!, $external: String!) {
    all: search(query: $all, type: ISSUE, first: 1) {
      issueCount
    }
    external: search(query: $external, type: ISSUE, first: 1) {
      issueCount
    }
  }
`;
