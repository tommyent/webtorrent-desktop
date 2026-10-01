const React = require('react')

const { dispatch, dispatcher } = require('../lib/dispatcher')
const config = require('../lib/config')
const { getRemovalSelection } = require('../lib/torrent-summary')

class Header extends React.Component {
  render () {
    const state = this.props.state
    const loc = state.location
    const removalCount = getRemovalSelection(state).length
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
          {loc.url() === 'home' && removalCount > 0 && (
            <button
              type='button'
              className='remove-selected'
              aria-label={'Remove ' + removalCount + ' selected torrents'}
              onClick={dispatcher('confirmRemoveSelected')}
            >
              Remove ({removalCount})
            </button>
          )}
          {loc.url() === 'home' && (
            <select
              className='torrent-sort'
              aria-label='Sort torrents'
              title='Sort torrents'
              value={state.saved.prefs.sortCompletedFirst ? 'completed' : 'added'}
              onChange={e => dispatch('updatePreferences', 'sortCompletedFirst', e.target.value === 'completed')}
            >
              <option value='added'>Recently added</option>
              <option value='completed'>Completed first</option>
            </select>
          )}
          {this.getAddButton()}
        </div>
      </div>
    )
  }

  getTitle () {
    if (config.PLATFORM !== 'darwin') return null
    const state = this.props.state
    // The Remove button needs the room; the list's title is just the app name
    if (state.location.url() === 'home' && getRemovalSelection(state).length > 0) return null
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
