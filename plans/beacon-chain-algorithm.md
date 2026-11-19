Use git commit C from repo R for file F as the starting beacon S_B.
#algorithm:
For file F, How many events exist between S_B and now?
- If more than 0, Are any of them a beacon?
- - If yes, Can we go from S_B to that first beacon without having to guess?
- - - If yes, add that beacon to the files list of beacons, then Set S_B to that beacon and run #algorithm again until you reach Now.
- - - If no: add this file to the list of files that need guesses and move to next file to check in the list.

Goal: eliminate files that have a clear walk from that commit to now and focus on the files that require guessing.
