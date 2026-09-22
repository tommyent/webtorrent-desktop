const React = require('react')

const { dispatcher } = require('../lib/dispatcher')
const config = require('../lib/config')

class Header extends React.Component {
  render () {
    const loc = this.props.state.location
    return (
      <div
        className='header'
        onMouseMove={dispatcher('mediaMouseMoved')}
        onMouseEnter={dispatcher('mediaControlsMouseEnter')}
        onMouseLeave={dispatcher('mediaControlsMouseLeave')}
        role='navigation'
      >
        {this.getTitle()}
        <div className='nav left float-left'>
          <button
            type='button'
            className={'icon back ' + (loc.hasBack() ? '' : 'disabled')}
            title='Back'
            onClick={dispatcher('back')}
            disabled={!loc.hasBack()}
            aria-label='Back'
          >
            chevron_left
          </button>
          <button
            type='button'
            className={'icon forward ' + (loc.hasForward() ? '' : 'disabled')}
            title='Forward'
            onClick={dispatcher('forward')}
            disabled={!loc.hasForward()}
            aria-label='Forward'
          >
            chevron_right
          </button>
        </div>
        <div className='nav right float-right'>
          {this.getAddButton()}
        </div>
      </div>
    )
  }

  getTitle () {
    if (config.PLATFORM !== 'darwin') return null
    const state = this.props.state
    return (<div className='title ellipsis'>{state.window.title}</div>)
  }

  getAddButton () {
    const state = this.props.state
    if (state.location.url() !== 'home') return null
    return (
      <button
        type='button'
        className='icon add'
        title='Add torrent'
        onClick={dispatcher('openFiles')}
      >
        add
      </button>
    )
  }
}

module.exports = Header
