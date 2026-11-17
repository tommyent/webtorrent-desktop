const React = require('react')
const { FlatButton } = require('./controls')
const { RaisedButton } = require('./controls')

module.exports = class ModalOKCancel extends React.Component {
  render () {
    const { cancelText, onCancel, okText, onOK, danger } = this.props
    return (
      <div className='modal-ok-cancel'>
        <FlatButton
          autoFocus
          className='control cancel'
          label={cancelText}
          onClick={onCancel}
        />
        <RaisedButton
          className='control ok'
          primary
          danger={danger}
          label={okText}
          onClick={onOK}
        />
      </div>
    )
  }
}
