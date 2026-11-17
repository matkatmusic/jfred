EngineV3 TUI:
basically the same bar elements that the WebApp shows in the barsTimelineArea. 

Webapp is where you do actual commit marks.
TUI is just a CLI viewer of the history. 

Requirements:

Same Engine code feeds TUI rendering that feeds the webapp rendering. 

same loading bar/status line in barsTimelineArea as webapp.

an info row at the bottom that shows details about the selection (number of commits/ number of jsonl events that modify the file, etc..)

"menu row" shows key commands:
- up/down: navigate
- s: (de)select
- Shift-S: select multiple
- r: reset stores for selection 
- shift-r: reset all stores
- left: advance selection towards "now"
- right: advance selection towards "earliest"
- shift-left: advance All rows toward "now"
- shift-right: advance All rows toward "earliest"

Info row also shows when errors during reconstruction happen.

has an `--auto` mode that basically does 'shift-right' until all rows have been reconstructed to the earliest point in the file history for the proejct. 

