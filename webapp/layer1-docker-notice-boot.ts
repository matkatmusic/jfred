// Starts the Docker notice at page load, outside layer1-page.ts so tests that boot that page never fetch the readiness route.

import { showDockerNoticeWhenDockerIsMissing } from "./layer1-components/popups/layer1-docker-notice.ts";

void showDockerNoticeWhenDockerIsMissing();
