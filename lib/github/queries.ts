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

/**
 * Which repositories feed the LANGUAGE chart.
 *
 * Worth understanding before changing: GitHub reports language bytes per
 * REPOSITORY, not per author. A repo you're a member of contributes its entire
 * breakdown whether you wrote three lines of it or all of it.
 *
 *   [OWNER]                            your own repos only, public + private
 *   [OWNER, COLLABORATOR]              + repos you were explicitly added to
 *   [OWNER, ORGANIZATION_MEMBER, ...]  + every org repo you can see  ← current
 *
 * The widest setting is the most complete picture of what you touch, but it
 * lets an employer's codebase dominate — which can end up describing the
 * company's stack rather than your own.
 */
export const LANGUAGE_AFFILIATIONS = "[OWNER, ORGANIZATION_MEMBER, COLLABORATOR]";

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
      # TWO separate connections, deliberately.
      #
      # languageRepos spans private and organisation repositories, because the
      # language chart is an aggregate — summed bytes reveal no repository names.
      #
      # publicRepos stays PUBLIC + OWNER because its names are RENDERED. Widening
      # it would publish private and client repository names on a public page.
      languageRepos: repositories(
        first: 100
        isFork: false
        ownerAffiliations: ${LANGUAGE_AFFILIATIONS}
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        totalCount
        nodes {
          nameWithOwner
          isPrivate
          pushedAt
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
      publicRepos: repositories(
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
        }
      }
    }
  }
`;

/**
 * Merged-PR counts, split three ways — and the split matters.
 *
 * "Merged into repos you don't own" sounds like open source, but on this
 * account 405 of 408 are in one private employer repository. Reporting that
 * number under an open-source-shaped label would be misleading to a recruiter
 * and awkward the moment anyone asks about it in an interview.
 *
 * So `openSource` filters on is:public as well, and the UI labels the two
 * differently. Team throughput and open-source contribution are both worth
 * showing; they are not the same claim.
 */
export const MERGED_PRS_QUERY = /* GraphQL */ `
  query MergedPrs($all: String!, $external: String!, $openSource: String!) {
    all: search(query: $all, type: ISSUE, first: 1) {
      issueCount
    }
    external: search(query: $external, type: ISSUE, first: 1) {
      issueCount
    }
    openSource: search(query: $openSource, type: ISSUE, first: 1) {
      issueCount
    }
  }
`;
