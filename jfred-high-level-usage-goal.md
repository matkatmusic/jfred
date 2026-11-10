Here's the overall goal for how I want JFRED and the EngineV3 to be usable:
after loading a repo, JSONL folders, file history snapshot folders:
I want this tool to have 2 main functionalities: 

## Main Functionalities
- 1. behave exactly like the Git GUI app "Fork", when viewing the "File Tree" tab for a selected commit:  Select any commit, view the file tree, select a file, see exactly that file's contents at that point in time. 
- 2. Select a range of commits and be able to cherry-pick or squash.

## Differences between JFRED and Fork 
The difference between JFRED and Fork is that JFRED shows every modifying line that occurred between actual git commits in the timeline ruler. 

The timeline ruler and 'SessionDotLines' are equivalent of the Git Commit lines in Fork.  The Timeline ruler and SessionDotLines differ from the Git Commit lines in Fork by only showing the timestamp of the event. 

The TimelineView (where FileBubbles are displayed) are the "File Tree" view for the entire chronological history of the project folder.  The top of a bubble represents the "Moment of creation" for that file.  If the file was deleted, the bottom of that bubble represents the "Moment of deletion" for that bubble. Otherwise, the bubble's bottom extends to the most recent timeline ruler event, representing that the file still exists in the project today.   Each node in the bubble represents an Event that touched the file (Write, Edit, Snapshot, git commit, Read, script execution that modified the file, etc..).  

Here are the equivalent functionalities for items 1 and 2 above:

## JFRED Equivalent Functionalities
1. Select any `TimelineRuler` item or `SessionDotLine` node, and scroll across the Timeline (where FileBubbles are shown) and select a file bubble that overlaps with the TimelineRuler item's dashed horizontal line, and the DetailsPane opens to show what that file looked like *at that exact moment in the project history*. 

2. In the top-most header row, click the "Commit mode" button. A "Commit column" is attached to the TimelineRuler component.  Instead of shift-clicking multiple commits to select them in Fork for export, the Commit tool in JFRED shows a scissor icon next to each timeline ruler item.  the scissor icons are how I select the range of timeline ruler events that I want to export as a git patch.  If the jfred branch has commits, then I, the user, can only click on 1 scissor icon at a time and the most recent commit on the jfred branch marks the start of the export range, and the clicked scissor icon marks the end of the export range.