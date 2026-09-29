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
    const filenames = api.dialogs.showOpen(this.props.purpose, api.path.dirname(this.props.value || ''))
    if (!Array.isArray(filenames)) return
    this.props.onChange && this.props.onChange(filenames[0])
  }

  render () {
    const id = this.props.title.replace(' ', '-').toLowerCase()
    const wrapperStyle = {
      alignItems: 'center',
      display: 'flex',
      width: '100%'
    }
    const labelStyle = {
      flex: '0 auto',
      marginRight: 10,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
    const textareaStyle = {
      color: '#fafafa'
    }
    const textFieldStyle = {
      flex: '1'
    }
    const text = this.props.value || ''
    const buttonStyle = {
      marginLeft: 10
    }

    return (
      <div className={this.props.className} style={wrapperStyle}>
        <label htmlFor={id} className='label' style={labelStyle}>
          {this.props.title}:
        </label>
        <TextField
          className='control' disabled id={id} value={text}
          inputStyle={textareaStyle} style={textFieldStyle}
        />
        <RaisedButton
          aria-label={'Change ' + this.props.title}
          className='control' label='Change' onClick={this.handleClick}
          style={buttonStyle}
        />
      </div>
    )
  }
}

module.exports = PathSelector
