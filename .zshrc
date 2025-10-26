# If not running interactively, don't do anything
[[ $- != *i* ]] && return

alias ls='ls --color=auto'
alias grep='grep --color=auto'
PS1='<~ Feel-The-Pain ~>'

fastfetch --logo /home/vishnu/Downloads/feel_the_pain.png --logo-type kitty --logo-width 30
export PATH=$HOME/.local/bin:$PATH

# Enable case-insensitive tab completion
autoload -Uz compinit && compinit
zstyle ':completion:*' matcher-list 'm:{a-zA-Z}={A-Za-z}' 'r:|[._-]=* r:|=*' 'l:|=* r:|=*'

