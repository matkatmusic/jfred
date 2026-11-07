
//fill these in or import them from the other engine versions
type RepoState = {
    // Define the structure of the repository state here
};

type CommitHash = {
    //operator for incrementing the commit hash
    
};

type Path = {

};
type JSONLLine = {

};

function applyCommitToState(commit: CommitHash, state: RepoState, repo: Path): RepoState {
    // Apply the commit to the state and return the new state
    return state;
}

function checkOutRepoAt(repo: Path, commit: CommitHash): RepoState {
    // Check out the repository at the given commit and return the state
    return {} as RepoState;
}

export function runReplay(repoState:RepoState, startingCommit: CommitHash, endingCommit: CommitHash, repo:Path, snapshots?:Path[], events?:JSONLLine[]) : RepoState {
    let currentCommit = startingCommit;
    let currentState = repoState;
    do {
        currentState = applyCommitToState(currentCommit, currentState, repo);
        ++currentCommit;
    } while( currentCommit <= endingCommit );

    return currentState;
}

