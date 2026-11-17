const api = require('../lib/api')
const React = require('react')
const PropTypes = require('prop-types')

const { RaisedButton } = require('./controls')
const { TextField } = require('./controls')

// Lets you pick a file or directory.
// Uses the system Open File dialog.
// You can't edit the text field directly.
class PathSelector extends React.Component {
  static propTypes () {
    return {
      className: PropTypes.string,
      id: PropTypes.string,
      onChange: PropTypes.func,
      purpose: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      value: PropTypes.string
    }
  }

  constructor (props) {
    super(props)
    this.handleClick = this.handleClick.bind(this)
  }

  handleClick () {
    // Nothing chosen yet: let main pick the purpose's default folder
    const value = this.props.value
    const filenames = api.dialogs.showOpen(this.props.purpose, value ? api.path.dirname(value) : undefined)
    if (!Array.isArray(filenames)) return
    this.props.onChange && this.props.onChange(filenames[0])
  }

  render () {
    const id = this.props.title.replace(' ', '-').toLowerCase()
    const text = this.props.value || ''
    const className = 'path-selector' + (this.props.className ? ' ' + this.props.className : '')

    return (
      <div className={className}>
        <label htmlFor={id} className='label'>
          {this.props.title}:
        </label>
        <TextField className='control' disabled id={id} value={text} />
        <RaisedButton
          aria-label={'Change ' + this.props.title}
          className='control' label='Change' onClick={this.handleClick}
        />
      </div>
    )
  }
}

module.exports = PathSelector
